import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, guard, TOO_MANY } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_IMAGE_BYTES, imageUrlFor, sniffImageType } from "@/lib/images";

const MAX_IMAGES_PER_USER = 200;
const MAX_BYTES_PER_USER = 100 * 1024 * 1024; // 100 MB

/** Unggah foto (multipart, field "file") untuk destinasi, event, atau produk UMKM. Mengembalikan URL yang lalu disimpan di imageUrl. */
export async function POST(req: Request) {
  // Foto event / destinasi (pelaku budaya) dan foto produk (pelaku UMKM).
  const g = await guard(["PRACTITIONER", "UMKM"]);
  if (!g.ok) return g.error;

  // Batas laju per pengguna, lalu kuota total per pengguna (foto disimpan di database).
  if (!rateLimit(`upload:${g.user.id}`, 20, 10 * 60_000)) return fail(TOO_MANY, 429);
  const used = await prisma.imageAsset.aggregate({
    where: { uploaderId: g.user.id },
    _count: { _all: true },
    _sum: { size: true },
  });
  if (used._count._all >= MAX_IMAGES_PER_USER || (used._sum.size ?? 0) >= MAX_BYTES_PER_USER) {
    return fail("Kuota unggahan foto akunmu sudah penuh. Hubungi kurator.", 403);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return fail("Body tidak valid");
  }
  if (!file || typeof file === "string") return fail("Pilih file foto");
  if (file.size === 0) return fail("File kosong");
  if (file.size > MAX_IMAGE_BYTES) return fail("Ukuran foto maksimal 2 MB");

  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffImageType(data);
  if (!mimeType) return fail("Format foto harus JPG, PNG, atau WebP");

  try {
    const image = await prisma.imageAsset.create({
      data: { mimeType, size: data.length, data, uploaderId: g.user.id },
      select: { id: true },
    });
    return NextResponse.json({ url: imageUrlFor(image.id) }, { status: 201 });
  } catch (error) {
    console.error("[pelaku/images] upload failed", error);
    return fail("Gagal menyimpan foto", 500);
  }
}
