import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect, { isKnownTankCode, useTankOptions } from "./TankSelect";
import { api, ApiError } from "../api/client";

/** Popup ringkas "Pindah Tanki" (2026-10-24, instruksi eksplisit user --
 * laporan nyata Order 1050009192: tanki lama rusak, Order-nya dipindah fisik
 * ke tanki lain TANPA mengulang proses apa pun). POST /dashboard/pindah-tanki
 * LANGSUNG MENIMPA Code Tanki di baris riwayat proses yg SAAT INI jadi acuan
 * Order ini (bukan menambah entri overlay terpisah spt versi awal) --
 * instruksi eksplisit user: mau kolom "Sumber Data" tetap "Input Admin", dan
 * histori yg tersimpan menunjukkan tanki TERBARU, bukan yg lama. Makanya
 * TIDAK ada field "Catatan" di sini (beda dari versi awal) -- baris yg
 * ditimpa bisa jadi baris riwayat proses APA SAJA (Premix/Milling/Aftermix/
 * Colour Matching/QC/Approval/Packing), yg strukturnya tidak semua py kolom
 * catatan yg konsisten, dan menimpa Code Tanki lama di situ memang SENGAJA
 * tidak meninggalkan jejak terpisah (lihat peringatan di teks popup).
 *
 * `order` optional: kalau sudah diketahui dari konteks pemanggil (popup Info
 * Proses per-Order), field Order ditampilkan read-only. Kalau tidak (tombol
 * toolbar Production Order Monitoring, belum terikat 1 baris tertentu), user
 * ketik sendiri nomor Order-nya. */
export default function PindahTankiModal({
  order: initialOrder,
  onClose,
  onSaved,
}: {
  order?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data: tanks } = useTankOptions();
  const [order, setOrder] = useState(initialOrder ?? "");
  const [codeTanki, setCodeTanki] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.post("/dashboard/pindah-tanki", { order: order.trim(), codeTanki }),
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal memindahkan tanki."),
  });

  function submit() {
    if (!order.trim()) {
      setError("Order wajib diisi.");
      return;
    }
    if (!isKnownTankCode(tanks, codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    setError("");
    mutation.mutate();
  }

  return createPortal(
    <Modal title={initialOrder ? `Pindah Tanki — Order ${initialOrder}` : "Pindah Tanki"} onClose={onClose} width={460}>
      <p style={{ marginTop: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Menimpa langsung Code Tanki di riwayat proses Order ini yang saat ini jadi acuan (Tank Monitoring, Production
        Order Monitoring, maupun History-nya sendiri ikut menampilkan tanki baru ini). Code Tanki lama{" "}
        <strong>tidak lagi tercatat di mana pun</strong> setelah ini -- pastikan tanki barunya sudah benar.
      </p>
      {!initialOrder && (
        <div className="field">
          <label>Order *</label>
          <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="Nomor Order" />
        </div>
      )}
      <div className="field" style={{ marginTop: initialOrder ? 0 : 10 }}>
        <label>Tanki Baru *</label>
        <TankSelect bare id="pindah-tanki-new" value={codeTanki} onChange={setCodeTanki} />
      </div>
      {error && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" className="btn" disabled={mutation.isPending} onClick={submit}>
          {mutation.isPending ? "Menyimpan..." : "Pindahkan"}
        </button>
      </div>
    </Modal>,
    document.body
  );
}
