import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createSession, hasActiveSession, revokeSession, revokeSessionsForUser } from "../../lib/session";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { clearFailures, isLocked, registerFailure } from "../../lib/loginAttempts";
import { createImageUploader, uploadToBlob } from "../../lib/uploadStorage";
import { HttpError } from "../../middleware/errorHandler";
import { env } from "../../lib/env";

export const authRouter = Router();

/** Preferensi personal Notifikasi Order Macet (2026-10-01, instruksi
 * eksplisit user: opt-in PER TAHAP + ambang personal, lepas dari departemen)
 * -- dipakai bareng oleh /login & /me supaya field & defaultnya konsisten. */
const NOTIF_PREF_SELECT = {
  email: true,
  notifyPremix: true,
  notifyMilling: true,
  notifyAftermix: true,
  notifyColourMatching: true,
  notifyQc: true,
  notifyApproval: true,
} as const;

function notifPrefDefaults(employee: {
  email: string | null;
  notifyPremix: boolean;
  notifyMilling: boolean;
  notifyAftermix: boolean;
  notifyColourMatching: boolean;
  notifyQc: boolean;
  notifyApproval: boolean;
} | null) {
  return {
    email: employee?.email ?? null,
    notifyPremix: employee?.notifyPremix ?? false,
    notifyMilling: employee?.notifyMilling ?? false,
    notifyAftermix: employee?.notifyAftermix ?? false,
    notifyColourMatching: employee?.notifyColourMatching ?? false,
    notifyQc: employee?.notifyQc ?? false,
    notifyApproval: employee?.notifyApproval ?? false,
  };
}

const loginSchema = z.object({
  nik: z.string().trim().min(1),
  password: z.string().min(1),
  // 1 NIK cuma boleh 1 sesi aktif (2026-08-08, instruksi eksplisit user, spt
  // SAP) -- kalau ada sesi lain yg masih aktif, login PERTAMA ditolak (409)
  // supaya frontend bisa tampilkan konfirmasi dulu ke user. `force: true`
  // dikirim ulang SETELAH user mengonfirmasi, artinya "akhiri sesi lain itu
  // dan lanjutkan login di sini".
  force: z.boolean().optional().default(false),
});

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "NIK dan password wajib diisi." });
      return;
    }
    const { nik, password } = parsed.data;

    // Mode maintenance (2026-08-09, instruksi eksplisit user): tolak SEMUA
    // login selain nik yang di-whitelist, sebelum cek password sekalipun --
    // supaya tidak ada celah timing/pesan yang membedakan NIK valid vs tidak.
    if (env.maintenanceMode && nik !== env.maintenanceAllowedNik) {
      res.status(423).json({
        success: false,
        message: "Sistem sedang dalam maintenance. Silakan coba lagi nanti.",
      });
      return;
    }

    if (isLocked(nik)) {
      res.status(429).json({
        success: false,
        message: "Terlalu banyak percobaan login gagal. Silakan coba lagi dalam beberapa menit.",
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { nik } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      registerFailure(nik);
      res.status(401).json({
        success: false,
        message: user ? "Incorrect password." : "Employee Identification Number (NIK) not found.",
      });
      return;
    }

    clearFailures(nik);

    if (await hasActiveSession(user.nik)) {
      if (!parsed.data.force) {
        res.status(409).json({
          success: false,
          conflict: true,
          message: "Akun ini sedang aktif di perangkat/browser lain. Lanjutkan login akan mengakhiri sesi tersebut.",
        });
        return;
      }
      await revokeSessionsForUser(user.nik, "login dari perangkat/browser lain");
    }

    const token = await createSession(user.nik, req.ip, req.headers["user-agent"]);
    const employee = await prisma.masterEmployee.findUnique({
      where: { employeeId: user.nik },
      select: NOTIF_PREF_SELECT,
    });

    res.json({
      success: true,
      message: "Login successful",
      token,
      nik: user.nik,
      name: user.name,
      department: user.department,
      access: user.access,
      hiddenMenus: user.hiddenMenus,
      viewOnlyMenus: user.viewOnlyMenus,
      mustResetPassword: user.mustResetPassword,
      avatarPath: user.avatarPath,
      ...notifPrefDefaults(employee),
    });
  })
);

authRouter.get(
  "/lookup/:nik",
  asyncRoute(async (req, res) => {
    const nik = String(req.params.nik ?? "").trim();
    if (!nik) {
      res.json({ success: false, name: "" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { nik }, select: { name: true } });
    if (!user) {
      res.json({ success: false, message: "NIK belum terdaftar." });
      return;
    }
    res.json({ success: true, name: user.name });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncRoute(async (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (token) await revokeSession(token);
    res.json({ success: true });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    // Email bukan field User (akun login) -- disimpan di MasterEmployee
    // (Data Karyawan), di-lookup pakai NIK = employeeId (2026-10-01, instruksi
    // eksplisit user: menu "cantumkan email" di Profil Akun, dan email itu
    // harus tampil juga di kolom Email Data Karyawan -- satu sumber data yg
    // sama, bukan field terpisah di User).
    const employee = await prisma.masterEmployee.findUnique({
      where: { employeeId: req.auth!.nik },
      select: NOTIF_PREF_SELECT,
    });
    res.json({
      success: true,
      ...req.auth,
      ...notifPrefDefaults(employee),
    });
  })
);

const updateMyEmailSchema = z.object({
  // `.toLowerCase()` SEBELUM `.email()` -- SELALU disimpan huruf kecil (2026-10-06,
  // instruksi eksplisit user: "jika ada 1 email dipakai oleh beberapa user
  // apakah bisa? harusnya dibikin tidak bisa") supaya `@unique` di schema.prisma
  // efektif case-insensitive, bukan cuma case-sensitive bawaan Postgres.
  email: z.string().trim().toLowerCase().email("Format email tidak valid.").nullable(),
});

authRouter.put(
  "/me/email",
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = updateMyEmailSchema.safeParse({ email: req.body.email === "" ? null : req.body.email });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." });
      return;
    }
    if (parsed.data.email) {
      const owner = await prisma.masterEmployee.findUnique({ where: { email: parsed.data.email } });
      if (owner && owner.employeeId !== req.auth!.nik) {
        res.status(409).json({
          success: false,
          message: `Email ini sudah dipakai oleh ${owner.fullName} (NIK ${owner.employeeId}).`,
        });
        return;
      }
    }
    // Upsert -- akun login yg NIK-nya belum ada baris di Master Data Karyawan
    // (mis. akun Administrator sistem) tetap bisa isi emailnya sendiri lewat
    // Profil Akun; baris baru otomatis terbentuk di Data Karyawan.
    const employee = await prisma.masterEmployee.upsert({
      where: { employeeId: req.auth!.nik },
      update: { email: parsed.data.email },
      create: {
        employeeId: req.auth!.nik,
        fullName: req.auth!.name,
        departemen: req.auth!.department,
        email: parsed.data.email,
      },
    });
    res.json({ success: true, message: "Email berhasil disimpan.", email: employee.email });
  })
);

/** Menu Settings > Notifikasi (2026-10-01, instruksi eksplisit user, revisi
 * ke-2: "dropdown pada setiap proses juga buat saja Aktif, Nonaktif ...
 * kalau user tersebut memilih untuk menyalakan notifikasi Approval, maka
 * user tersebut akan menerima email notifikasi approval"). Preferensi
 * PRIBADI milik user ybs sendiri, PER TAHAP -- SIAPA SAJA yg login boleh
 * mengaktifkan tahap mana pun, LEPAS dari `departemen` miliknya. Hanya
 * berefek nyata kalau user ybs juga sudah isi email (lihat query di
 * orderDelayAlertScheduler.ts). Ambang Lead Time Proses & jam kirim BUKAN
 * lagi preferensi di sini (2026-10-06, instruksi eksplisit user: pindah jadi
 * GLOBAL, cuma diatur developer/admin lewat menu Pengaturan SMTP). */
const updateNotifPrefsSchema = z.object({
  notifyPremix: z.boolean(),
  notifyMilling: z.boolean(),
  notifyAftermix: z.boolean(),
  notifyColourMatching: z.boolean(),
  notifyQc: z.boolean(),
  notifyApproval: z.boolean(),
});

authRouter.put(
  "/me/order-delay-notif",
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = updateNotifPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." });
      return;
    }
    const employee = await prisma.masterEmployee.upsert({
      where: { employeeId: req.auth!.nik },
      update: parsed.data,
      create: {
        employeeId: req.auth!.nik,
        fullName: req.auth!.name,
        departemen: req.auth!.department,
        ...parsed.data,
      },
    });
    res.json({
      success: true,
      message: "Preferensi Notifikasi Order Macet berhasil disimpan.",
      ...notifPrefDefaults(employee),
    });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter."),
});

authRouter.post(
  "/change-password",
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { nik: req.auth!.nik } });
    if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      res.status(401).json({ success: false, message: "Password saat ini salah." });
      return;
    }
    await prisma.user.update({
      where: { nik: user.nik },
      data: { passwordHash: hashPassword(parsed.data.newPassword), mustResetPassword: false },
    });
    res.json({ success: true, message: "Password berhasil diubah." });
  })
);

const avatarUpload = createImageUploader(3);

authRouter.post(
  "/avatar",
  requireAuth,
  avatarUpload.single("avatar"),
  asyncRoute(async (req: AuthedRequest, res) => {
    if (!req.file) throw new HttpError(400, "File foto wajib diunggah.");
    const avatarPath = await uploadToBlob("avatars", req.file);
    await prisma.user.update({ where: { nik: req.auth!.nik }, data: { avatarPath } });
    res.json({ success: true, message: "Foto avatar berhasil diperbarui.", avatarPath });
  })
);
