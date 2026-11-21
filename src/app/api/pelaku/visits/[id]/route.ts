import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fail, firstIssue, readBody } from "@/lib/api";
import { guardPelaku, ownedVisitWhere } from "@/lib/pelaku-api";
import { dayString, toDay } from "@/lib/tanggal";
import { visitUpdateSchema } from "@/lib/pelaku-validators";
import { ACTIVE_VISIT, KuotaError, ensureCapacity, noticeVisits, upcomingVisits } from "@/lib/kuota";
import { audit } from "@/lib/audit";

const findVisit = (user: Parameters<typeof ownedVisitWhere>[0], id: string) =>
  prisma.visit.findFirst({ where: { id, ...ownedVisitWhere(user) }, select: { id: true, objectId: true, eventId: true, status: true, userId: true, visitDate: true, partySize: true } });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guardPelaku();
  if (!g.ok) return g.error;

  const existing = await findVisit(g.user, params.id);
  if (!existing) return fail("Data kunjungan tidak ditemukan", 404);

  const body = await readBody(req);
  if (body === null) return fail("Body tidak valid");
  const parsed = visitUpdateSchema.safeParse(body);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;

  // Kunjungan ke event mandiri selalu menunjuk event itu; hanya kunjungan destinasi yang boleh ditandai kegiatan lain.
  if (d.eventId !== undefined && !existing.objectId) return fail("Event pada kunjungan ini tidak bisa diubah", 400);
  if (d.eventId) {
    const event = await prisma.culturalEvent.findFirst({ where: { id: d.eventId, objectId: existing.objectId }, select: { id: true } });
    if (!event) return fail("Event tidak sesuai dengan destinasi", 400);
  }

  try {
    // Pendaftaran online yang dibatalkan pengelola: kabari penggunanya.
    if (d.status === "CANCELLED" && existing.status === "BOOKED" && existing.userId) {
      await noticeVisits(await upcomingVisits({ id: existing.id }), "Pendaftaranmu dibatalkan oleh pengelola.", true);
    }
    const dateChanged = d.visitDate !== undefined && toDay(d.visitDate).getTime() !== existing.visitDate.getTime();
    const sizeChanged = d.partySize !== undefined && d.partySize !== existing.partySize;
    const newStatus = d.status ?? existing.status;
    const wasActive = (ACTIVE_VISIT as readonly string[]).includes(existing.status);
    const willBeActive = (ACTIVE_VISIT as readonly string[]).includes(newStatus);
    // Kuota diperiksa bila kunjungan aktif dan jumlah orang bertambah, tanggalnya pindah, atau ia diaktifkan kembali.
    const needsCapacity =
      willBeActive && ((d.partySize !== undefined && d.partySize > existing.partySize) || dateChanged || !wasActive);
    const targetEventId = d.eventId !== undefined ? d.eventId : existing.eventId;
    const target = existing.objectId ? { objectId: existing.objectId, eventId: targetEventId } : { eventId: existing.eventId! };

    await prisma.$transaction(async (tx) => {
      if (needsCapacity) {
        await ensureCapacity(tx, target, d.visitDate ?? dayString(existing.visitDate), d.partySize ?? existing.partySize, existing.id);
      }
      await tx.visit.update({
        where: { id: existing.id },
        data: {
          ...(d.visitorName !== undefined ? { visitorName: d.visitorName } : {}),
          ...(d.contact !== undefined ? { contact: d.contact || null } : {}),
          ...(d.partySize !== undefined ? { partySize: d.partySize } : {}),
          ...(d.visitDate !== undefined ? { visitDate: toDay(d.visitDate) } : {}),
          ...(d.note !== undefined ? { note: d.note || null } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.eventId !== undefined ? { eventId: d.eventId } : {}),
        },
      });
    });
    // Perubahan tanggal / jumlah orang pada pendaftaran online dikabari ke wisatawannya (setelah berhasil disimpan).
    if (existing.userId && existing.status === "BOOKED" && newStatus === "BOOKED" && (dateChanged || sizeChanged)) {
      await noticeVisits(await upcomingVisits({ id: existing.id }), "Pengelola mengubah tanggal atau jumlah orang pada pendaftaranmu.", false);
    }
    await audit(g.user.id, "UPDATE_VISIT", "VISIT", existing.id, Object.keys(d).join(","));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof KuotaError) return fail(error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Pengunjung ini sudah terdaftar pada tanggal tersebut", 409);
    }
    console.error("[pelaku/visits] update failed", error);
    return fail("Gagal memperbarui kunjungan", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guardPelaku();
  if (!g.ok) return g.error;

  const existing = await findVisit(g.user, params.id);
  if (!existing) return fail("Data kunjungan tidak ditemukan", 404);

  try {
    await prisma.visit.delete({ where: { id: existing.id } });
    await audit(g.user.id, "DELETE_VISIT", "VISIT", existing.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[pelaku/visits] delete failed", error);
    return fail("Gagal menghapus kunjungan", 500);
  }
}
