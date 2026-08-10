import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Migrasi History Packing lama (2026-08-10, instruksi eksplisit user) ke
 * format baru "Qty/Pcs per-Member". Data lama HANYA punya 1 Qty/Pcs gabungan
 * utk seluruh tim (dibagi rata saat dihitung), jadi TIDAK ADA cara utk tahu
 * hasil kerja asli tiap orang -- migrasi ini murni membagi rata angka lama
 * ke tiap Member supaya tampilan History konsisten dgn format baru
 * (KOSMETIK, bukan data historis yang benar-benar akurat per orang).
 *
 * Baris yang SEMUA Member-nya SUDAH punya qtyPcs (diinput lewat form baru)
 * dilewati apa adanya -- tidak ditimpa.
 */

interface RawMember {
  name?: unknown;
  nik?: unknown;
  qtyPcs?: unknown;
}

function splitEqually(total: number, count: number): string {
  const result = total / count;
  return Number.isInteger(result) ? String(result) : result.toFixed(2);
}

async function main() {
  const rows = await prisma.packingLog.findMany({
    select: { id: true, order: true, members: true, qtyPcs: true },
  });

  let migrated = 0;
  let skippedAlreadyNew = 0;
  let skippedNoData = 0;

  for (const row of rows) {
    const raw = row.members;
    if (!Array.isArray(raw) || raw.length === 0) {
      skippedNoData++;
      continue;
    }

    const parsed = raw.map((entry) => {
      if (typeof entry === "string") return { name: entry.trim(), nik: null as string | null, qtyPcs: undefined as string | undefined };
      const e = entry as RawMember;
      const name = String(e.name ?? "").trim();
      const nik = typeof e.nik === "string" && e.nik.trim() ? e.nik.trim() : null;
      const qtyPcs = typeof e.qtyPcs === "string" && e.qtyPcs.trim() ? e.qtyPcs.trim() : undefined;
      return { name, nik, qtyPcs };
    }).filter((m) => m.name);

    if (parsed.length === 0) {
      skippedNoData++;
      continue;
    }

    // Sudah format baru (minimal 1 Member punya qtyPcs sendiri) -- lewati, jangan ditimpa.
    if (parsed.some((m) => m.qtyPcs)) {
      skippedAlreadyNew++;
      continue;
    }

    const total = Number(row.qtyPcs);
    if (!row.qtyPcs || !row.qtyPcs.trim() || Number.isNaN(total)) {
      skippedNoData++;
      continue;
    }

    const share = splitEqually(total, parsed.length);
    const nextMembers = parsed.map((m) => ({ name: m.name, nik: m.nik, qtyPcs: share }));

    await prisma.packingLog.update({
      where: { id: row.id },
      data: { members: nextMembers },
    });
    migrated++;
    console.log(`Order ${row.order} (id ${row.id}): ${parsed.length} member -- qtyPcs total ${total} dibagi rata jadi ${share}/orang.`);
  }

  console.log(`\nSelesai. Dimigrasi: ${migrated}, sudah format baru (dilewati): ${skippedAlreadyNew}, tidak ada data utk dibagi (dilewati): ${skippedNoData}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
