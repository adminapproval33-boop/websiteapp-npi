import nodemailer from "nodemailer";
import { env } from "./env";
import { HttpError } from "../middleware/errorHandler";

/**
 * Kirim email lewat SMTP kantor (Office 365/Google Workspace) -- dipakai
 * fitur Notifikasi Order Macet (2026-09-30, instruksi eksplisit user). Kredensial
 * disiapkan IT lewat 5 env var (SMTP_HOST/PORT/USER/PASS/FROM di .env), sama
 * pola "lazy client, gagal dgn pesan jelas kalau belum dikonfigurasi" spt
 * lib/googleSheets.ts.
 */
function getMailTransport() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    throw new HttpError(
      500,
      "SMTP belum dikonfigurasi di server (.env): isi SMTP_HOST, SMTP_USER & SMTP_PASS (kredensial email kantor dari IT)."
    );
  }
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPass },
  });
}

export async function sendMail(opts: { to: string[]; subject: string; html: string }): Promise<void> {
  const transport = getMailTransport();
  await transport.sendMail({
    from: env.smtpFrom,
    to: opts.to.join(", "),
    subject: opts.subject,
    html: opts.html,
  });
}
