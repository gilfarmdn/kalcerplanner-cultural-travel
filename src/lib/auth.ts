import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { roleHome } from "@/lib/role-home";
import { COOKIE_NAME, sessionCookieOptions, signSession, verifySession } from "@/lib/session-token";

export type SessionUser = { id: string; name: string; email: string };

/** Membuat sesi baru (cookie sesi: berakhir saat peramban ditutup atau 45 menit tanpa aktivitas). */
export async function createSession(user: SessionUser) {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, sessionEpoch: true } });
  cookies().set(COOKIE_NAME, await signSession(user, undefined, passwordFingerprint(row?.passwordHash ?? "", row?.sessionEpoch ?? 0)), sessionCookieOptions);
}

/** Sidik pendek dari hash password + epoch sesi: berubah saat password diganti/reset atau pengguna keluar, sehingga sesi lama gugur. */
function passwordFingerprint(passwordHash: string, epoch: number): string {
  return createHash("sha256").update(`${passwordHash}:${epoch}`).digest("hex").slice(0, 16);
}

/** Keluar: cookie dihapus DAN semua sesi yang pernah diterbitkan untuk akun ini dicabut di server. */
export async function revokeSessions(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { sessionEpoch: { increment: 1 } } }).catch((e) => console.error("[auth] revoke failed", e));
}

export function destroySession() {
  cookies().set(COOKIE_NAME, "", { ...sessionCookieOptions, maxAge: 0 });
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "TRAVELER" | "PRACTITIONER" | "UMKM" | "ADMIN";
  avatarUrl: string | null;
};

/** Session user re-read from the database (fresh role/profile). Null if signed out or the account is gone. */
export async function getUser(): Promise<CurrentUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const claims = token ? await verifySession(token) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    select: { id: true, name: true, email: true, role: true, avatarUrl: true, deactivatedAt: true, passwordHash: true, sessionEpoch: true },
  });
  // Akun yang dinonaktifkan kurator diperlakukan seperti sudah keluar.
  if (!user || user.deactivatedAt) return null;
  // Password sudah diganti/direset sejak sesi ini dibuat: sesi dicabut.
  if (passwordFingerprint(user.passwordHash, user.sessionEpoch) !== claims.pv) return null;
  const { deactivatedAt: _, passwordHash: __, sessionEpoch: ___, ...rest } = user;
  return rest;
}

/** For server pages that need a signed-in user: redirects visitors to the login page and back. */
export async function requireUser(next: string): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect(`/masuk?next=${encodeURIComponent(next)}`);
  return user;
}

/** Halaman khusus satu jenis akun: akun lain diarahkan ke halaman utamanya (lihat roleHome). */
export async function requireRole(role: CurrentUser["role"], next: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (user.role !== role) redirect(roleHome(user.role));
  return user;
}

/** Halaman khusus pelaku budaya. */
export function requirePractitioner(next: string): Promise<CurrentUser> {
  return requireRole("PRACTITIONER", next);
}

/** Halaman khusus pelaku UMKM. */
export function requireUmkm(next: string): Promise<CurrentUser> {
  return requireRole("UMKM", next);
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = await verifySession(token);
  return claims ? { id: claims.id, name: claims.name, email: claims.email } : null;
}
