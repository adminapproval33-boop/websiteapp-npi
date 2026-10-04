import "dotenv/config";
import fs from "fs";
import path from "path";
import { list } from "@vercel/blob";
import { uploadsDir } from "../lib/uploadStorage";

/**
 * Migrasi SEKALI JALAN (2026-10-04, instruksi eksplisit user): salin semua
 * file lampiran lama yang masih tersangkut di Vercel Blob (akun kena suspend
 * limit Data Transfer bulanan, baru reset 19/10/26 -- lihat diskusi Backup &
 * Storage) ke penyimpanan lokal (server/data/uploads/) yang sekarang dipakai
 * aplikasi (lihat lib/uploadStorage.ts & modules/files/files.routes.ts).
 *
 * TIDAK mengubah apa pun di database -- pathname di Vercel Blob (mis.
 * "posts/169xxx-uuid.jpg") PERSIS SAMA formatnya dengan path relatif yang
 * sudah tersimpan di kolom filePath/avatarPath/dll, jadi begitu file fisiknya
 * ada di lokal dengan path yang sama, langsung otomatis bisa diakses lagi.
 *
 * CARA PAKAI:
 *   1. Pastikan akses Vercel Blob store sudah aktif lagi (bukan suspended) --
 *      cek dashboard Vercel > Storage dulu.
 *   2. Isi BLOB_READ_WRITE_TOKEN di server/.env (nilai lama ada di riwayat
 *      Vercel dashboard > Storage > nama store > tab ".env.local" / Settings,
 *      kalau sudah tidak ada simpan dari sebelumnya, generate token baru).
 *   3. Jalankan dari folder server/: npm run migrate:vercel-blob
 *   4. Setelah selesai & dicek filenya sudah muncul normal di aplikasi, boleh
 *      hapus lagi BLOB_READ_WRITE_TOKEN dari .env dan copot dependency
 *      "@vercel/blob" (`npm uninstall @vercel/blob --workspace=server`) --
 *      script ini & dependency-nya cuma dibutuhkan sekali ini saja.
 *
 * Aman dijalankan berkali-kali: file yang sudah ada di lokal (nama sama)
 * dilewati, tidak ditimpa ulang.
 */

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      "BLOB_READ_WRITE_TOKEN belum diisi di server/.env. Isi dulu dengan token Vercel Blob yang lama (lihat komentar di atas file ini), lalu jalankan ulang."
    );
    process.exitCode = 1;
    return;
  }

  const root = uploadsDir();
  let migrated = 0;
  let skippedExists = 0;
  let failed = 0;
  let cursor: string | undefined;

  for (let page = 0; ; page += 1) {
    const result = await list({ token, cursor, limit: 1000 });
    console.log(`Halaman ${page + 1}: ${result.blobs.length} file ditemukan di Vercel Blob.`);

    for (const blob of result.blobs) {
      const destPath = path.join(root, blob.pathname);
      if (fs.existsSync(destPath)) {
        skippedExists++;
        continue;
      }
      try {
        const res = await fetch(blob.url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.writeFile(destPath, buffer);
        migrated++;
        console.log(`OK  ${blob.pathname} (${(blob.size / 1024).toFixed(1)} KB)`);
      } catch (err) {
        failed++;
        console.error(`GAGAL  ${blob.pathname}:`, err instanceof Error ? err.message : err);
      }
    }

    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  console.log(`\nSelesai. Berhasil disalin: ${migrated}, sudah ada di lokal (dilewati): ${skippedExists}, gagal: ${failed}.`);
  if (failed > 0) {
    console.log("Jalankan lagi script ini untuk mencoba ulang file yang gagal (file yang sudah berhasil tidak akan diulang).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
