import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import TankSelect, { isKnownTankCode, useTankOptions } from "./TankSelect";
import OrderLookup, { OrderRefData } from "./OrderLookup";
import { api, ApiError } from "../api/client";

function refField(label: string, value: string | null | undefined) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value ?? ""} readOnly />
    </div>
  );
}

/** Popup ringkas "Pindah Tanki" (2026-10-24, instruksi eksplisit user --
 * laporan nyata Order 1050009192 & 1010166475: tanki lama rusak, Order-nya
 * dipindah fisik ke tanki lain TANPA mengulang proses apa pun). POST
 * /dashboard/pindah-tanki LANGSUNG MENIMPA Code Tanki di SEMUA baris riwayat
 * proses Order ini yg kebetulan tercatat di tanki LAMA yg sama (bukan cuma
 * baris yg lagi jadi acuan) -- instruksi eksplisit user: mau kolom "Sumber
 * Data" tetap "Input Admin", histori yg tersimpan menunjukkan tanki TERBARU,
 * DAN perpindahannya tercatat di Remark tiap baris yg ditimpa (ditambahkan,
 * bukan menggantikan Remark lama) supaya ada jejak yg kelihatan.
 *
 * REVISI (2026-10-24, instruksi eksplisit user lanjutan):
 * 1) Material Number/Description/Batch/Order Qty/Plant ditampilkan read-only
 *    begitu Order ketemu di Referensi Order/PO (SAP-COOISPI) -- supaya user
 *    bisa konfirmasi visual ini Order yg benar sebelum menekan Pindahkan,
 *    sama tujuannya dgn field serupa di BookingEditModal/ManualInputModal.
 * 2) Kalau nomor Order yg diketik TIDAK ketemu di situ (kemungkinan salah
 *    ketik), tampil peringatan jelas -- SENGAJA tidak memblokir submit sama
 *    sekali (endpoint-nya sendiri bekerja dari riwayat proses Order, BUKAN
 *    dari Referensi Order/PO, jadi Order yg valid tapi kebetulan belum/tidak
 *    ada di situ -- mis. Order lama sebelum re-import Master Data -- tetap
 *    harus bisa dipindah) -- cuma pengingat visual.
 * 3) Field "Alasan Pindah" (wajib) -- alasan pindah tanki (mis. "Despa rusak/
 *    mixer problem"), ikut ditulis endpoint ke catatan Remark tiap baris yg
 *    ditimpa (lihat komentar backend), supaya BUKAN cuma "pindah dari A ke
 *    B" tapi juga KENAPA.
 *
 * `order` optional: kalau sudah diketahui dari konteks pemanggil (popup Info
 * Proses per-Order), field Order ditampilkan read-only (lookup tetap jalan
 * otomatis di belakang layar). Kalau tidak (tombol toolbar Production Order
 * Monitoring, belum terikat 1 baris tertentu), user ketik sendiri nomor
 * Order-nya lewat OrderLookup (cari pakai Enter/blur, sama pola komponen ini
 * dipakai di seluruh aplikasi). */
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
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Lookup Referensi Order/PO -- 2 jalur: `initialOrder` (sudah pasti, dari
  // Info Proses) pakai useQuery langsung; Order ketik-sendiri (toolbar) pakai
  // OrderLookup (cari lewat Enter/blur, bukan tiap ketikan) via onFound/onNotFound.
  const [typedOrderRef, setTypedOrderRef] = useState<OrderRefData | null>(null);
  const [typedOrderNotFound, setTypedOrderNotFound] = useState(false);

  const initialOrderRefQuery = useQuery({
    queryKey: ["order-ref-pindah-tanki", initialOrder],
    queryFn: () => api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder!)}`).then((r) => r.data),
    enabled: Boolean(initialOrder),
    retry: false,
  });

  const orderRef = initialOrder ? initialOrderRefQuery.data ?? null : typedOrderRef;
  const orderNotFound = initialOrder ? initialOrderRefQuery.isError : typedOrderNotFound;

  // Order diketik ulang (toolbar) -- hasil lookup lama sudah tidak relevan,
  // kosongkan dulu supaya tidak nyangkut data Order SEBELUMNYA saat yg baru
  // belum/gagal dicari (sama alasan dgn pola onNotFound di OrderLookup.tsx).
  useEffect(() => {
    if (!initialOrder) {
      setTypedOrderRef(null);
      setTypedOrderNotFound(false);
    }
  }, [order, initialOrder]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; message: string; data?: { rowsUpdated?: number } }>("/dashboard/pindah-tanki", {
        order: order.trim(),
        codeTanki,
        reason: reason.trim(),
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
    if (!reason.trim()) {
      setError("Alasan Pindah wajib diisi.");
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
            supaya jejak pemindahan (dan alasannya) tetap kelihatan.
          </p>
          {!initialOrder && (
            <OrderLookup
              value={order}
              onChange={setOrder}
              onFound={(data) => {
                setTypedOrderRef(data);
                setTypedOrderNotFound(false);
              }}
              onNotFound={() => {
                setTypedOrderRef(null);
                setTypedOrderNotFound(true);
              }}
            />
          )}
          {orderNotFound && (
            <p className="error-text" style={{ marginTop: -4, marginBottom: 10 }}>
              Nomor Order ini tidak ada di data Cooispi -- periksa lagi, mungkin salah ketik. (Tetap bisa dipindah
              kalau memang Order ini valid tapi belum/tidak ada di Referensi Order/PO.)
            </p>
          )}
          {orderRef && (
            <div className="field-grid" style={{ marginBottom: 10 }}>
              {refField("Material Number", orderRef.materialNumber)}
              {refField("Material Description", orderRef.materialDescription)}
              {refField("Batch", orderRef.batch)}
              {refField("Order Qty", orderRef.orderQty)}
              {refField("Plant", orderRef.plant)}
            </div>
          )}
          <div className="field" style={{ marginTop: initialOrder ? 0 : 10 }}>
            <label>Tanki Baru *</label>
            <TankSelect bare id="pindah-tanki-new" value={codeTanki} onChange={setCodeTanki} />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Alasan Pindah *</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. Despa rusak / mixer problem" />
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
