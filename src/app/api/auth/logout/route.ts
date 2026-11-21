import { NextResponse } from "next/server";
import { destroySession, getSession, revokeSessions } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  if (session) await revokeSessions(session.id);
  destroySession();
  return NextResponse.json({ ok: true });
}
