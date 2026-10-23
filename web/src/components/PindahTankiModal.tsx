import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect, { isKnownTankCode, useTankOptions } from "./TankSelect";
import { api, ApiError } from "../api/client";

/** Popup ringkas "Pindah Tanki" (2026-10-24, instruksi eksplisit user --
 * laporan nyata Order 1050009192 & 1010166475: tanki lama rusak, Order-nya
 * dipindah fisik ke tanki lain TANPA mengulang proses apa pun). POST
 * /dashboard/pindah-tanki LANGSUNG MENIMPA Code Tanki di SEMUA baris riwayat
 * proses Order ini yg kebetulan tercatat di tanki LAMA yg sama (bukan cuma
 * baris yg lagi jadi acuan) -- instruksi eksplisit user: mau kolom "Sumber
 * Data" tetap "Input Admin", histori yg tersimpan menunjukkan tanki TERBARU,
 * DAN perpindahannya tercatat di Remark tiap baris yg ditimpa (ditambahkan,
 * bukan menggantikan Remark lama) supaya ada jejak yg kelihatan. Makanya
 * TIDAK ada field "Catatan" terpisah di sini -- catatannya SUDAH otomatis
 * ditulis endpoint-nya sendiri ke Remark tiap baris.
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
  const [successMessage, setSuccessMessage] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; message: string; data?: { rowsUpdated?: number } }>("/dashboard/pindah-tanki", {
        order: order.trim(),
        codeTanki,
      }),
    onSuccess: (res) => {
      onSaved?.();
      setSuccessMessage(res.message);
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
      {successMessage ? (
        <>
          <p className="status-text" style={{ marginTop: 0 }}>
            {successMessage}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>
              Tutup
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Menimpa langsung Code Tanki di SEMUA baris riwayat proses Order ini yang kebetulan tercatat di tanki lama
            yang sama (bukan cuma yang terakhir) -- Tank Monitoring, Production Order Monitoring, maupun History-nya
            sendiri ikut menampilkan tanki baru ini. Tiap baris yang ditimpa otomatis dapat catatan di Remark-nya
            supaya jejak pemindahan tetap kelihatan.
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
        </>
      )}
    </Modal>,
    document.body
  );
}
