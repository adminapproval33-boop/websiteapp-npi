import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect, { isKnownTankCode, useTankOptions } from "./TankSelect";
import { api, ApiError } from "../api/client";

/** Popup ringkas "Pindah Tanki" (2026-10-24, instruksi eksplisit user --
 * laporan nyata Order 1050009192: tanki lama rusak, Order-nya dipindah fisik
 * ke tanki lain TANPA mengulang proses apa pun). Reuse endpoint "+Input
 * Manual" (POST /production-order-manual-input) yg SUDAH "menang mutlak" di
 * Tank Monitoring & (sejak 2026-10-24) Production Order Monitoring juga --
 * TAPI form penuhnya (ManualInputModal.tsx) kepanjangan utk sekadar pindah
 * tanki (wajib SPV Produksi/Leader/dll). Popup ini CUMA minta Code Tanki
 * baru. Field "Catatan" dikirim lewat kolom `spvProduksi` apa adanya
 * (SENGAJA -- tabel ProductionOrderManualInput tidak py kolom catatan
 * terpisah) supaya alasan pindah tetap tercatat di riwayat "Input Manual"
 * tanpa perlu migrasi skema baru.
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
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.post("/production-order-manual-input", { order: order.trim(), codeTanki, spvProduksi: catatan.trim() }),
    onSuccess: () => {
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan pindah tanki."),
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
        Memindahkan Order ini ke tanki baru -- tanki lama otomatis berhenti dianggap occupant Order ini (di Tank
        Monitoring maupun Production Order Monitoring), tanpa perlu mengulang input proses apa pun.
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
      <div className="field" style={{ marginTop: 10 }}>
        <label>Catatan (opsional)</label>
        <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. tanki lama rusak" />
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
