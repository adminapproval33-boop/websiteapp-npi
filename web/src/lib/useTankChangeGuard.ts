import { useCallback, useRef, useState } from "react";
import { api } from "../api/client";

interface PendingTankChange {
  previousTank: string;
  newTanks: string[];
}

/**
 * Popup konfirmasi "pindah tanki" sebelum Save (2026-09-29, instruksi
 * eksplisit user) -- root cause yg sama dgn perbaikan Tank Monitoring "tanki
 * nyangkut Terisi" (Order pindah tanki di tengah proses tapi tanki lama
 * tidak pernah dibebaskan): dulu tidak ada apa pun yg mengingatkan admin
 * kalau Code Tanki yg baru diketik BEDA dari tanki yg tercatat di proses
 * SEBELUMNYA (lintas modul manapun) utk Order yg sama -- jadi typo/salah
 * pilih tanki lolos begitu saja, atau perpindahan tanki yg genuinely
 * disengaja (mis. rework/"Improve") tidak pernah dikonfirmasi eksplisit.
 *
 * Dipakai di tiap form Input (Premix/Aftermix/Milling/Colour Matching/Check
 * Results/Approval): panggil `checkTankChange(order, [codeTanki, ...])`
 * SEBELUM memanggil mutation Save yg sebenarnya -- kalau resolve `true`,
 * lanjutkan Save spt biasa; kalau `false`, batalkan (user pilih "Batal" di
 * popup). Render `pending` lewat <TankChangeConfirmDialog> (lihat komponen
 * terpisah) supaya UI-nya konsisten di semua halaman.
 */
export function useTankChangeGuard() {
  const [pending, setPending] = useState<PendingTankChange | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const checkTankChange = useCallback(async (order: string, newTanks: Array<string | null | undefined>): Promise<boolean> => {
    const trimmedOrder = order.trim();
    const cleanedNew = Array.from(new Set(newTanks.map((t) => (t ?? "").trim()).filter(Boolean)));
    if (!trimmedOrder || cleanedNew.length === 0) return true;

    let previousTank: string | undefined;
    try {
      const res = await api.get<{ success: boolean; data: { codeTanki: string } | null }>(
        `/dashboard/latest-tank-by-order/${encodeURIComponent(trimmedOrder)}`
      );
      previousTank = res.data?.codeTanki?.trim() || undefined;
    } catch {
      // Gagal cek (mis. network) -- ini cuma pemberitahuan tambahan, jangan
      // sampai memblokir Save krn endpoint pengecekannya sendiri bermasalah.
      return true;
    }
    if (!previousTank || cleanedNew.includes(previousTank)) return true;

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ previousTank: previousTank!, newTanks: cleanedNew });
    });
  }, []);

  const confirmProceed = useCallback(() => {
    resolverRef.current?.(true);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const cancel = useCallback(() => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setPending(null);
  }, []);

  return { pending, checkTankChange, confirmProceed, cancel };
}
