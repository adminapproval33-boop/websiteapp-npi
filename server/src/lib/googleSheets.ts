import { google } from "googleapis";
import { env } from "./env";
import { HttpError } from "../middleware/errorHandler";

/**
 * Sync data ke Google Sheet lewat Service Account (2026-08-23, instruksi
 * eksplisit user -- menu Approval > Lot History > tombol "Sync ke Google
 * Sheet"). Auth pakai JWT Service Account (bukan OAuth interaktif) karena ini
 * dipanggil dari backend tanpa user login Google -- Spreadsheet target HARUS
 * di-share ke email Service Account (role Editor) dulu di Google Sheets,
 * kalau tidak Sheets API akan menolak dengan 403/404.
 */
function getSheetsClient() {
  if (!env.googleServiceAccountEmail || !env.googleServiceAccountPrivateKey) {
    throw new HttpError(
      500,
      "Google Sheets belum dikonfigurasi di server (.env): isi GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }
  const auth = new google.auth.JWT({
    email: env.googleServiceAccountEmail,
    key: env.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * Timpa TOTAL isi 1 sheet/tab (termasuk header) dengan `rows` baru --
 * "Overwrite semua" (pilihan eksplisit user drpd mode Append), supaya tombol
 * Sync bisa diklik berkali-kali tanpa bikin duplikat. `sheetName` harus persis
 * sama dgn nama tab di Google Sheet (mis. "New List Approval").
 */
export async function overwriteSheet(sheetName: string, rows: (string | number | null)[][]): Promise<void> {
  if (!env.googleApprovalSheetId) {
    throw new HttpError(500, "Google Sheets belum dikonfigurasi di server (.env): isi GOOGLE_APPROVAL_SHEET_ID.");
  }
  const sheets = getSheetsClient();
  const range = `'${sheetName.replace(/'/g, "''")}'`;

  try {
    // Kosongkan dulu seluruh tab supaya baris lama (mis. sisa sync sebelumnya
    // yang lebih panjang dari data sekarang) tidak nyangkut di bawah data baru.
    await sheets.spreadsheets.values.clear({ spreadsheetId: env.googleApprovalSheetId, range });
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.googleApprovalSheetId,
      range: `${range}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  } catch (err: any) {
    const apiMessage = err?.errors?.[0]?.message || err?.message || "Gagal menulis ke Google Sheet.";
    if (err?.code === 404 || /Unable to parse range|not found/i.test(apiMessage)) {
      throw new HttpError(
        502,
        `Tab "${sheetName}" tidak ditemukan di Google Sheet tujuan. Pastikan nama tab persis sama (huruf besar/kecil & spasi).`
      );
    }
    if (err?.code === 403) {
      throw new HttpError(
        502,
        `Google Sheet menolak akses Service Account (${env.googleServiceAccountEmail}). Pastikan Spreadsheet sudah di-share ke email itu dengan role Editor.`
      );
    }
    throw new HttpError(502, `Gagal sync ke Google Sheet: ${apiMessage}`);
  }
}
