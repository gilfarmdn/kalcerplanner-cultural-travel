import { prisma } from "@/lib/prisma";

/** Mencatat satu aksi (siapa, apa, terhadap apa, kapan). Tidak pernah melempar: kegagalan catat tidak menggagalkan aksinya. */
export async function audit(actorId: string, action: string, targetType: string, targetId?: string | null, detail?: string) {
  try {
    await prisma.auditLog.create({ data: { actorId, action, targetType, targetId: targetId ?? null, detail: detail?.slice(0, 500) ?? null } });
  } catch (error) {
    console.error("[audit] gagal mencatat", action, error);
  }
}
