import path from "path";
import crypto from "crypto";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env";
import { r2Client } from "./r2Client";

const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];
const ALLOWED_MIME_EXACT = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel.sheet.csv",
  "text/plain",
];

function isAllowedMime(mimeType: string): boolean {
  const mt = mimeType.toLowerCase();
  return ALLOWED_MIME_PREFIXES.some((p) => mt.startsWith(p)) || ALLOWED_MIME_EXACT.includes(mt);
}

/**
 * Membuat instance multer yang menampung file di memori (buffer), dengan
 * validasi tipe file & ukuran (setara `assertValidUpload_` di versi Apps
 * Script -- hanya gambar, PDF, Word, atau Excel; maksimum sesuai MAX_UPLOAD_MB).
 * File-nya sendiri baru benar-benar diunggah lewat uploadToR2().
 */
export function createUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedMime(file.mimetype)) {
        cb(new Error(`Tipe file "${file.mimetype}" tidak diizinkan. Hanya gambar, PDF, Word, atau Excel yang bisa diunggah.`));
        return;
      }
      cb(null, true);
    },
  });
}

/** Unggah buffer file ke Cloudflare R2 di bawah `<subfolder>/`, kembalikan object key (disimpan sebagai filePath di DB). */
export async function uploadToR2(subfolder: string, file: Express.Multer.File): Promise<string> {
  const safeExt = path.extname(file.originalname).slice(0, 10);
  const key = path.posix.join(subfolder, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return key;
}
