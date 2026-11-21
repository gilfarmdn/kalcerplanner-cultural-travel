import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { fail, firstIssue, guard, readBody } from "@/lib/api";
import { verifySchema } from "@/lib/validators";

/** Kurator (ADMIN) memverifikasi atau menolak event yang diajukan pelaku, dan mencatat penanda dampaknya. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(["ADMIN"]);
  if (!g.ok) return g.error;

  const body = await readBody(req);
  if (body === null) return fail("Body tidak valid");
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { action, localRun, hiddenGem } = parsed.data;

  try {
    const result = await prisma.culturalEvent.updateMany({
      // Hanya event yang diajukan pelaku (mandiri maupun pada destinasi); catatan kalender bawaan tidak lewat kurasi.
      where: { id: params.id, ownerId: { not: null } },
      data:
        action === "VERIFY"
          ? {
              status: "VERIFIED",
              verifiedAt: new Date(),
              ...(localRun !== undefined ? { localRun } : {}),
              ...(hiddenGem !== undefined ? { hiddenGem } : {}),
            }
          : { status: "REJECTED", verifiedAt: null },
    });
    if (result.count === 0) return fail("Data tidak ditemukan", 404);
    await audit(g.user.id, parsed.data.action, "EVENT", params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events] verify failed", error);
    return fail("Gagal memperbarui status", 500);
  }
}
