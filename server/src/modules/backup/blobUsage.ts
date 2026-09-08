import { list } from "@vercel/blob";
import { env } from "../../lib/env";

export interface BlobUsage {
  totalBytes: number;
  fileCount: number;
  /** true kalau berhenti lebih awal (batas halaman tercapai) -- angka di atas jadi perkiraan minimum, bukan total pasti. */
  truncated: boolean;
}

const MAX_PAGES = 20; // 20 x 1000 = sampai 20.000 file lampiran, cukup longgar utk ukuran pemakaian saat ini.

/** Total pemakaian Vercel Blob (lampiran upload) -- bagian dari fitur kontrol
 * storage (2026-09-08) supaya admin bisa lihat SEMUA tempat data tersimpan,
 * bukan cuma folder backup lokal. */
export async function getBlobUsage(): Promise<BlobUsage> {
  let totalBytes = 0;
  let fileCount = 0;
  let cursor: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await list({ token: env.blobReadWriteToken, cursor, limit: 1000 });
    for (const blob of result.blobs) {
      totalBytes += blob.size;
      fileCount += 1;
    }
    if (!result.hasMore) {
      cursor = undefined;
      break;
    }
    cursor = result.cursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { totalBytes, fileCount, truncated };
}
