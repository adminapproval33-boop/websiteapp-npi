import { prisma } from "./prisma";

/**
 * True kalau `code` persis ada di Master Data Tanki (2026-08-08, instruksi
 * eksplisit user: Code Tanki wajib persis seperti format di dropdown, mis.
 * "TA08000079" yg lolos tersimpan sebelumnya harusnya "TA.04500.079").
 * BEDA dari sanitizeNik di lib/employeeNik.ts (yg silently null-kan NIK
 * tidak valid, krn NIK di modul lain cuma field pelengkap) -- Code Tanki
 * menggerakkan dashboard okupansi tanki, jadi nilai tidak valid harus
 * DITOLAK TEGAS (400) di route pemanggil, bukan diam-diam dikosongkan.
 */
export async function isValidTankCode(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return true; // kosong bukan tanggung jawab helper ini -- required/optional diatur di zod schema masing2 route
  const found = await prisma.masterTank.findUnique({ where: { code: trimmed } });
  return Boolean(found);
}
