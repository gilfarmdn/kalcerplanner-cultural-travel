import type { NextResponse } from "next/server";
import { fail, TOO_MANY } from "@/lib/api";
import { MAX_IMAGE_BYTES } from "@/lib/image-rules";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export const MAX_IMAGES_PER_USER = 200;
export const MAX_BYTES_PER_USER = 100 * 1024 * 1024; // 100 MB

/**
 * Penjaga bersama untuk semua rute unggah gambar ke ImageAsset. Dipanggil SEBELUM badan permintaan dibaca:
 * menolak ukuran jelas terlalu besar, membatasi laju per pengguna, lalu menegakkan kuota total per pengguna.
 * Mengembalikan respons galat, atau null bila unggahan boleh lanjut.
 */
export async function guardUpload(req: Request, userId: string): Promise<NextResponse | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) return fail("Ukuran foto maksimal 2 MB", 413);

  if (!rateLimit(`upload:${userId}`, 20, 10 * 60_000)) return fail(TOO_MANY, 429);

  const used = await prisma.imageAsset.aggregate({
    where: { uploaderId: userId },
    _count: { _all: true },
    _sum: { size: true },
  });
  if (used._count._all >= MAX_IMAGES_PER_USER || (used._sum.size ?? 0) >= MAX_BYTES_PER_USER) {
    return fail("Kuota unggahan foto akunmu sudah penuh. Hubungi kurator.", 403);
  }
  return null;
}
