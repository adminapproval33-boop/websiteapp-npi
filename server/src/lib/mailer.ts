import nodemailer from "nodemailer";
import { env } from "./env";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { HttpError } from "../middleware/errorHandler";

interface ResolvedSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Kirim email lewat SMTP kantor -- dipakai fitur Notifikasi Order Macet
 * (2026-09-30, instruksi eksplisit user). Kredensial diutamakan dari
 * `SmtpSetting` (tabel DB, diisi lewat form web menu Developer Tools >
 * Pengaturan SMTP -- 2026-10-02, saran Pak Ilham/Digitalisasi NPI supaya
 * admin tidak perlu akses file server langsung), fallback ke 5 env var
 * SMTP_HOST/PORT/USER/PASS/FROM di .env kalau baris DB itu belum diisi/
 * dinonaktifkan (dev lokal lewat .env tetap jalan apa adanya).
 */
async function resolveSmtpConfig(): Promise<ResolvedSmtpConfig | null> {
  const setting = await prisma.smtpSetting.findUnique({ where: { id: "singleton" } });
  if (setting?.enabled && setting.host && setting.user && setting.pass) {
    const fromEmail = setting.fromEmail || setting.user;
    return {
      host: setting.host,
      port: setting.port,
      user: setting.user,
      pass: decryptSecret(setting.pass),
      from: setting.fromName ? `${setting.fromName} <${fromEmail}>` : fromEmail,
    };
  }
  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    return { host: env.smtpHost, port: env.smtpPort, user: env.smtpUser, pass: env.smtpPass, from: env.smtpFrom || env.smtpUser };
  }
  return null;
}

async function getMailTransport() {
  const config = await resolveSmtpConfig();
  if (!config) {
    throw new HttpError(
      500,
      "SMTP belum dikonfigurasi. Isi lewat menu Developer Tools > Pengaturan SMTP, atau isi SMTP_HOST/SMTP_USER/SMTP_PASS di .env server."
    );
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  return { transport, from: config.from };
}

export async function sendMail(opts: { to: string[]; subject: string; html: string }): Promise<void> {
  const { transport, from } = await getMailTransport();
  await transport.sendMail({
    from,
    to: opts.to.join(", "),
    subject: opts.subject,
    html: opts.html,
  });
}
