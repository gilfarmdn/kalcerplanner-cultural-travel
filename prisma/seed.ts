import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

/** Optional: create an ADMIN (curator) account from env vars so the first deployment can verify data. */
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn("ADMIN_PASSWORD must be at least 8 characters — admin not created.");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Akun kurator dianggap sudah terverifikasi (dibuat oleh pengelola, bukan pendaftaran mandiri).
    // Seed hanya MEMBUAT admin; akun yang sudah ada (mis. didaftarkan orang lain dengan email ini) tidak dipromosikan.
    console.warn(`ADMIN_EMAIL ${email} sudah terdaftar; seed tidak mengubah role akun itu. Ubah manual lewat database bila memang diinginkan.`);
    return;
  }
  await prisma.user.create({
    data: {
      name: "Kurator KalcerPlanner",
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Admin account created for ${email}`);
}

async function main() {
  // Tidak ada data budaya / UMKM awal: semua data dibuat pengguna (pelaku budaya dan UMKM) lalu diverifikasi kurator.
  await seedAdmin();
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
