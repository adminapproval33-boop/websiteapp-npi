import { prisma } from "./prisma";

/**
 * Pastikan NIK yg dikirim client benar-benar ada di Data Karyawan sebelum
 * disimpan -- kalau tidak ketemu (klien lama/bug/manipulasi devtools),
 * simpan `null` (nama tetap tersimpan apa adanya) drpd nyimpen NIK asal.
 * SENGAJA tidak mencocokkan NIK ini terhadap nama yg dikirim bareng --
 * itu balik lagi ke masalah pencocokan nama yg ambigu (2 karyawan nama
 * sama) yg justru sedang diperbaiki lewat penyimpanan NIK eksplisit ini.
 */
export async function sanitizeNik(nik: string | null | undefined): Promise<string | null> {
  const trimmed = (nik ?? "").trim();
  if (!trimmed) return null;
  const found = await prisma.masterEmployee.findUnique({ where: { employeeId: trimmed } });
  return found ? trimmed : null;
}

export interface MemberInput {
  name: string;
  nik?: string | null;
  /** Qty/Pcs per-Member (dipakai Packing, lihat MemberEntry.qtyPcs di frontend) -- lewat apa adanya, tidak divalidasi di sini (murni angka hasil kerja, bukan identitas). */
  qtyPcs?: string;
}

export interface SanitizedMember {
  name: string;
  nik: string | null;
  qtyPcs?: string;
}

/** Versi batch dari `sanitizeNik` utk array Member -- 1 query utk semua NIK sekaligus. */
export async function sanitizeMembers(members: MemberInput[] | undefined | null): Promise<SanitizedMember[]> {
  if (!members || members.length === 0) return [];
  const niks = Array.from(new Set(members.map((m) => (m.nik ?? "").trim()).filter(Boolean)));
  const found = niks.length
    ? await prisma.masterEmployee.findMany({ where: { employeeId: { in: niks } }, select: { employeeId: true } })
    : [];
  const validNiks = new Set(found.map((f) => f.employeeId));
  return members
    .map((m) => ({
      name: m.name.trim(),
      nik: m.nik && validNiks.has(m.nik.trim()) ? m.nik.trim() : null,
      qtyPcs: m.qtyPcs?.trim() || undefined,
    }))
    .filter((m) => m.name);
}
