import { promises as dns } from "dns";
import { prisma } from "@/lib/prisma";

/** true = alamat boleh dikirimi email. */
export async function canSendTo(email: string): Promise<boolean> {
  // Catatan bounce kedaluwarsa setelah 30 hari agar alamat yang sudah diperbaiki bisa dipakai lagi (pemulihan akun).
  const bounce = await prisma.emailBounce.findUnique({ where: { email }, select: { createdAt: true } });
  if (bounce) {
    if (Date.now() - bounce.createdAt.getTime() < 30 * 24 * 60 * 60_000) return false;
    await prisma.emailBounce.delete({ where: { email } }).catch(() => undefined);
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return !(code === "ENOTFOUND" || code === "ENODATA"); // gangguan DNS sementara tidak memblokir
  }
}
