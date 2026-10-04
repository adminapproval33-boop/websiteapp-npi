import crypto from "crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

/** Kunci enkripsi: pakai ENCRYPTION_KEY dari .env kalau diisi, kalau tidak
 * diturunkan dari DATABASE_URL (selalu ada, wajib) -- supaya kredensial spt
 * SmtpSetting.pass (2026-10-02, instruksi eksplisit user: tampilan SMTP
 * diganti spt saran Pak Ilham, termasuk klaim "kata sandi dienkripsi") tetap
 * terenkripsi di database walau ENCRYPTION_KEY belum diisi admin -- bukan
 * sekadar disimpan polos. */
function getKey(): Buffer {
  const material = env.encryptionKey || env.databaseUrl;
  return crypto.createHash("sha256").update(material).digest();
}

/** Format tersimpan: "<iv>:<authTag>:<ciphertext>", semua base64. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
