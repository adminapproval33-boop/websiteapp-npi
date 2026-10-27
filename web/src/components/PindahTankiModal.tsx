import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface PindahTankiHistoryEntry {
  order: string;
  oldCodeTanki: string;
  newCodeTanki: string;
  dateLabel: string;
  by: string;
  reason: string | null;
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
 * REVISI (2026-10-27, instruksi eksplisit user lanjutan):
 * 4) Field "Tanki Awal" read-only -- preview Code Tanki yg SAAT INI jadi
 *    acuan Order ini (GET /pindah-tanki/current-tank, reuse persis logika
 *    "Langkah 1" POST /pindah-tanki) SEBELUM user submit, supaya user bisa
 *    konfirmasi dulu tanki lama yg bakal ditimpa itu benar sebelum menekan
 *    Pindahkan. Independen dari Referensi Order/PO (baris proses, BUKAN
 *    Cooispi) -- utk jalur toolbar (Order ketik-sendiri) baru dipicu setelah
 *    OrderLookup commit (found ATAU not-found), BUKAN tiap ketikan.
 * 5) Daftar riwayat SEMUA perpindahan tanki yg pernah dilakukan lintas Order
 *    (GET /pindah-tanki/history) ditampilkan di popup yg SAMA (bukan popup
 *    terpisah) -- di-parse backend dari catatan Remark baku yg ditulis POST
 *    /pindah-tanki, di-dedupe per-aksi (1 aksi pindah bisa cascade ke banyak
 *    baris, tapi harus tetap 1 baris di riwayat ini). Selalu tampil (baik di
 *    state form maupun setelah submit berhasil) supaya pindah yg baru saja
 *    dilakukan langsung kelihatan masuk ke daftar.
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

  // Preview "Tanki Awal" -- independen dari Referensi Order/PO (lihat
  // komentar di atas), tapi utk jalur toolbar baru dipicu setelah OrderLookup
  // commit (found/not-found), BUKAN tiap ketikan.
  const tankLookupEnabled = Boolean(order.trim()) && (Boolean(initialOrder) || Boolean(orderRef) || orderNotFound);
  const currentTankQuery = useQuery({
    queryKey: ["pindah-tanki-current-tank", order.trim()],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { codeTanki: string | null } }>(`/dashboard/pindah-tanki/current-tank?order=${encodeURIComponent(order.trim())}`)
        .then((r) => r.data),
    enabled: tankLookupEnabled,
    retry: false,
  });

  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["pindah-tanki-history"],
    queryFn: () => api.get<{ success: boolean; data: PindahTankiHistoryEntry[] }>("/dashboard/pindah-tanki/history").then((r) => r.data),
    retry: false,
  });

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
      queryClient.invalidateQueries({ queryKey: ["pindah-tanki-history"] });
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
    <Modal title={initialOrder ? `Pindah Tanki — Order ${initialOrder}` : "Pindah Tanki"} onClose={onClose} width={640}>
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
          {tankLookupEnabled && (
            <div style={{ marginTop: orderRef ? 0 : 10 }}>
              {refField(
                "Tanki Awal",
                currentTankQuery.isFetching
                  ? "Memuat..."
                  : currentTankQuery.data?.codeTanki ?? "Order ini belum punya riwayat proses apa pun"
              )}
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
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
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-color, #e2e2e2)" }}>
        <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: "0.85rem" }}>Riwayat Pindah Tanki</p>
        {historyQuery.isLoading ? (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Memuat riwayat...</p>
        ) : historyQuery.isError ? (
          <p className="error-text" style={{ fontSize: "0.8rem" }}>
            Gagal memuat riwayat pindah tanki.
          </p>
        ) : !historyQuery.data || historyQuery.data.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Belum ada Order yang pernah dipindah tankinya.</p>
        ) : (
          <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border-color, #e2e2e2)", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "var(--panel-bg, #fff)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Order</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Tanki Lama</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Tanki Baru</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Tanggal</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Oleh</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data.map((entry, i) => (
                  <tr key={`${entry.order}-${entry.dateLabel}-${i}`} style={{ borderTop: "1px solid var(--border-color, #e2e2e2)" }}>
                    <td style={{ padding: "6px 8px" }}>{entry.order}</td>
                    <td style={{ padding: "6px 8px" }}>{entry.oldCodeTanki}</td>
                    <td style={{ padding: "6px 8px" }}>{entry.newCodeTanki}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{entry.dateLabel}</td>
                    <td style={{ padding: "6px 8px" }}>{entry.by}</td>
                    <td style={{ padding: "6px 8px" }}>{entry.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>,
    document.body
  );
}
