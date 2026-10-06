import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { sendMail } from "../../lib/mailer";
import { encryptSecret } from "../../lib/crypto";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess, AuthedRequest } from "../../middleware/auth";

/** Pengaturan SMTP (2026-10-02, saran Pak Ilham/Digitalisasi NPI: "minta
 * claude untuk buatkan form config diweb admin, lalu bpk input situ" --
 * supaya admin tidak perlu akses file .env server langsung tiap mau ganti
 * kredensial email). Menu Developer Tools > Pengaturan SMTP, khusus admin
 * (FULL_ACCESS), sama pola dgn /api/backup/settings. */
export const smtpRouter = Router();

smtpRouter.use(requireAuth, requireFullAccess);

async function getOrCreateSetting() {
  return prisma.smtpSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

smtpRouter.get(
  "/settings",
  asyncRoute(async (_req, res) => {
    const setting = await getOrCreateSetting();
    // `pass` SENGAJA tidak pernah dikirim ke frontend -- cuma info apa sudah
    // terisi atau belum, supaya form bisa tampilkan placeholder "tidak
    // berubah" (spt pola kata sandi di reference screenshot user) tanpa
    // bocorin kredensial asli ke network tab/browser.
    res.json({
      success: true,
      data: {
        enabled: setting.enabled,
        host: setting.host,
        port: setting.port,
        user: setting.user,
        fromName: setting.fromName,
        fromEmail: setting.fromEmail,
        hasPassword: Boolean(setting.pass),
        // GLOBAL, cuma diatur developer/admin di sini (2026-10-06, instruksi
        // eksplisit user: pindah dari "Ambang Lead Time Proses" personal di
        // menu Settings > Notifikasi, supaya cuma developer yg menentukan
        // data mana yg terkirim, + jam kirim notifikasi juga diatur di sini,
        // gantikan konstanta CHECK_HOUR yg sebelumnya hardcode).
        notifyThresholdDays: setting.notifyThresholdDays,
        notifySendHour: setting.notifySendHour,
        notifySendMinute: setting.notifySendMinute,
        updatedAt: setting.updatedAt,
      },
    });
  })
);

const settingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1, "Host SMTP wajib diisi."),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().min(1, "Nama pengguna wajib diisi."),
  // Kosong/tidak dikirim = pertahankan password lama (user tidak mengetik
  // ulang) -- sama pola dgn field password di modul lain yg "kosongkan jika
  // tidak diubah" (lihat updateUserSchema di users.routes.ts).
  pass: z.string().optional(),
  fromName: z.string().trim().nullable().optional(),
  fromEmail: z.string().trim().email("Format alamat pengirim tidak valid.").nullable().optional(),
  notifyThresholdDays: z.number().int().min(1).max(365),
  notifySendHour: z.number().int().min(0).max(23),
  notifySendMinute: z.number().int().min(0).max(59),
});

smtpRouter.put(
  "/settings",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." });
      return;
    }
    // Dienkripsi (AES-256-GCM, lihat lib/crypto.ts) sebelum disimpan -- bukan
    // teks polos di database, sesuai info yg ditampilkan di form.
    const { pass, ...rest } = parsed.data;
    const encryptedPass = pass ? encryptSecret(pass) : undefined;
    const setting = await prisma.smtpSetting.upsert({
      where: { id: "singleton" },
      update: { ...rest, ...(encryptedPass ? { pass: encryptedPass } : {}), updatedByNik: req.auth!.nik },
      create: { id: "singleton", ...rest, pass: encryptedPass ?? null, updatedByNik: req.auth!.nik },
    });
    res.json({
      success: true,
      message: "Pengaturan SMTP berhasil disimpan.",
      data: { ...setting, pass: undefined, hasPassword: Boolean(setting.pass) },
    });
  })
);

const testSendSchema = z.object({
  // Opsional: alamat tujuan uji bebas (2026-10-06, instruksi eksplisit user
  // -- sebelumnya email uji selalu ke Alamat Pengirim, tidak bisa dites ke
  // alamat lain seperti ilham.putra@nipseapaint.com tanpa mengubah Alamat
  // Pengirim yang sebenarnya). Kosong/tidak dikirim = fallback ke Alamat
  // Pengirim/Nama Pengguna seperti semula.
  to: z.string().trim().email("Format alamat tujuan uji tidak valid.").optional(),
});

smtpRouter.post(
  "/test-send",
  asyncRoute(async (req, res) => {
    const setting = await getOrCreateSetting();
    if (!setting.enabled) {
      throw new HttpError(400, "Aktifkan dulu status SMTP sebelum mengirim email uji.");
    }
    const parsed = testSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." });
      return;
    }
    const target = parsed.data.to || setting.fromEmail || setting.user;
    if (!target) {
      throw new HttpError(400, "Isi dulu Alamat Pengirim/Nama Pengguna sebelum mengirim email uji.");
    }
    await sendMail({
      to: [target],
      subject: "[MES NPI] Email Uji Pengaturan SMTP",
      html: `<p>Ini email uji dari menu Developer Tools &gt; Pengaturan SMTP. Kalau email ini sampai, pengaturan SMTP Anda sudah benar.</p>`,
    });
    res.json({ success: true, message: `Email uji berhasil dikirim ke ${target}.` });
  })
);
