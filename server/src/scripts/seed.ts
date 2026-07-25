import "dotenv/config";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";

async function main() {
  const nik = process.env.SEED_ADMIN_NIK ?? "000001";
  const name = process.env.SEED_ADMIN_NAME ?? "Administrator";
  const department = process.env.SEED_ADMIN_DEPARTMENT ?? "IT";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const existing = await prisma.user.findUnique({ where: { nik } });
  if (existing) {
    console.log(`User admin dengan NIK ${nik} sudah ada, tidak dibuat ulang.`);
    return;
  }

  await prisma.user.create({
    data: {
      nik,
      name,
      department,
      access: "FULL_ACCESS",
      passwordHash: hashPassword(password),
      mustResetPassword: true,
    },
  });

  console.log(`Akun Full Access pertama dibuat: NIK=${nik}, password sementara="${password}".`);
  console.log("User ini akan diminta ganti password saat login pertama kali.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
