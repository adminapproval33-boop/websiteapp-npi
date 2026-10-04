import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import sharp from "sharp";
import { env } from "./env";

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
 * File-nya sendiri baru benar-benar diunggah lewat uploadToBlob().
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

/** Sama seperti createUploader(), tapi khusus foto avatar -- hanya gambar (bukan PDF/Word/Excel), limit ukuran lebih kecil. */
export function createImageUploader(maxMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.toLowerCase().startsWith("image/")) {
        cb(new Error(`Tipe file "${file.mimetype}" tidak diizinkan. Avatar harus berupa gambar (JPG/PNG/WebP).`));
        return;
      }
      cb(null, true);
    },
  });
}

// Disk server terbatas -- foto kamera HP biasa bisa 3-8 MB, padahal titik
// upload di aplikasi ini ada belasan (QC, Approval, Milling, Maintenance,
// Packing, avatar, dst, lihat semua pemanggil uploadToBlob()). 2026-10-04,
// instruksi eksplisit user (diteruskan dari keluhan Pak Ilham/Digitalisasi
// NPI: "kalau bisa yg data image kalau bisa dicompress dulu sizenya
// sebelum di simpan").
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_JPEG_QUALITY = 80;

/** Perkecil dimensi & kompres ulang jadi JPEG kalau filenya gambar DAN hasil
 * kompresinya benar-benar lebih kecil -- kalau gagal diproses (format aneh/
 * rusak) atau hasilnya malah lebih besar, kembalikan file asli apa adanya
 * (upload tidak boleh gagal gara-gara kompresi). PDF/Word/Excel tidak
 * disentuh sama sekali. */
async function compressImageIfSmaller(
  file: Express.Multer.File
): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const originalExt = path.extname(file.originalname).slice(0, 10);
  if (!file.mimetype.toLowerCase().startsWith("image/")) {
    return { buffer: file.buffer, contentType: file.mimetype, ext: originalExt };
  }
  try {
    const compressed = await sharp(file.buffer)
      .rotate() // terapkan orientasi EXIF dulu (mis. foto dari HP) sebelum metadata-nya dibuang.
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    if (compressed.length < file.buffer.length) {
      return { buffer: compressed, contentType: "image/jpeg", ext: ".jpg" };
    }
  } catch {
    // Format gambar yg tidak didukung sharp, atau filenya korup -- simpan apa adanya.
  }
  return { buffer: file.buffer, contentType: file.mimetype, ext: originalExt };
}

/** Folder permanen tempat file lampiran upload disimpan (2026-10-04, instruksi
 * eksplisit user: migrasi dari Vercel Blob -- akun kena suspend limit Data
 * Transfer bulanan, & Cloudflare R2 ditolak krn wajib daftar kartu kredit
 * meski gratis di bawah limit -- jadi disk server sendiri saja, tanpa pihak
 * ketiga). Default: `server/data/uploads` (folder ini sudah ada & di-.gitignore
 * dari sebelumnya), SELALU folder tetap di disk, TIDAK PERNAH os.tmpdir(). */
export function uploadsDir(): string {
  return env.uploadsDir || path.resolve(__dirname, "../../data/uploads");
}

/** Unggah buffer file ke disk lokal di bawah `<subfolder>/`, kembalikan path
 * relatif (disimpan sebagai filePath di DB). Content-Type saat disajikan
 * kembali (lihat files.routes.ts) ditentukan otomatis dari ekstensi file oleh
 * res.sendFile() -- makanya ekstensi hasil kompresi SELALU diikutkan di nama file. */
export async function uploadToBlob(subfolder: string, file: Express.Multer.File): Promise<string> {
  const { buffer, ext } = await compressImageIfSmaller(file);
  const relativePath = path.posix.join(subfolder, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  const destPath = path.join(uploadsDir(), relativePath);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);
  return relativePath;
}
