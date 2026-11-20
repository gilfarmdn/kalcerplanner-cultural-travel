import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readBody, fail, TOO_MANY } from "@/lib/api";
import { sendResetEmail } from "@/lib/auth-mail";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { issueToken } from "@/lib/tokens";
import { TURNSTILE_FAILED, verifyTurnstile } from "@/lib/turnstile";
import { emailOnlySchema } from "@/lib/validators";
import { canSendTo } from "@/lib/email-check";

/** Meminta tautan reset password. Tautan hanya dikirim ke email yang terdaftar, tetapi respons selalu sama. */
export async function POST(req: Request) {
  if (!rateLimit(`forgot-ip:${clientKey(req)}`, 10, 60 * 60_000)) return fail(TOO_MANY, 429);

  const body = await readBody(req);
  if (body === null) return fail("Body tidak valid");
  if (!(await verifyTurnstile((body as { turnstileToken?: unknown }).turnstileToken, clientKey(req)))) {
    return fail(TURNSTILE_FAILED, 400, "TURNSTILE_FAILED");
  }
  const parsed = emailOnlySchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Input tidak valid");

  if (!rateLimit(`forgot-email:${parsed.data.email}`, 3, 60 * 60_000)) return fail(TOO_MANY, 429);

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, name: true, email: true },
    });
    // Respons sama untuk email terdaftar maupun tidak, agar tidak bisa dipakai menebak akun yang ada.
    const uniform = NextResponse.json({ ok: true, email: parsed.data.email });
    if (!user) return uniform;
    if (!(await canSendTo(user.email))) return uniform; // jangan kirim ke alamat bounce

    const token = await issueToken(user.id, "RESET_PASSWORD");
    await sendResetEmail(req, user, token);
    return uniform;
  } catch (error) {
    console.error("[auth/forgot-password] failed", error);
    return fail("Gagal mengirim tautan reset. Coba lagi nanti.", 500);
  }
}
