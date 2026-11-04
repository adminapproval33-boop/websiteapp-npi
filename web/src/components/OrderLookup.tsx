import { useState } from "react";
import { api, ApiError } from "../api/client";

export interface OrderRefData {
  order: string;
  batch: string | null;
  materialNumber: string | null;
  materialDescription: string | null;
  orderQty: string | null;
  /// Kolom "Order quantity (GMEIN)" (varian Pcs, BEDA dari `orderQty` yg
  /// varian /LITER) di Referensi Order/PO (SAP-COOISPI) -- 2026-08-21,
  /// instruksi eksplisit user utk Label Entry FG. Optional sama pola dgn
  /// `orderType` di bawah -- pemanggil `onFound` yg bikin objek manual
  /// (loadIntoInput di beberapa halaman lain) tidak semuanya peduli field ini.
  orderQtyPcs?: string | null;
  plant: string | null;
  /// Kolom "JENIS" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Types of Products" di Colour Matching.
  jenis: string | null;
  /// Kolom "WARNA DASAR" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Base Color" di Colour Matching.
  warnaDasar: string | null;
  /// Kolom "Volume" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Volume" di Packing.
  volume: string | null;
  /// Kolom "Order Type" di Referensi Order/PO (SAP-COOISPI) -- dipakai MaterialFlowPanel utk mengunci Simpan
  /// Wajib/Tidak saat Order Type-nya RF01/RF02 (2026-08-03, instruksi eksplisit user). Optional (bukan semua
  /// pemanggil OrderLookup.onFound peduli field ini, mis. loadIntoInput di halaman lain yg bikin objek manual).
  orderType?: string | null;
}

/** Sel kosong di source SAP-COOISPI (setelah diproses macro Excel/VBA) sering
 * kesimpan sbg literal "-", BUKAN benar-benar kosong -- kalau dibiarkan, "-"
 * ini truthy di JS, jadi logika fallback di halaman consumer (mis. "data.jenis
 * || nilaiHistoriLama") keliru menganggap Master Data "sudah ada isinya"
 * padahal cuma placeholder kosong, dan nilai histori yang benar tidak pernah
 * kepakai. Dibersihkan di SINI (bukan di tiap halaman consumer satu-satu)
 * supaya SEMUA konsumen OrderRefData otomatis aman, termasuk yang belum
 * ditulis. Ditemukan dari laporan user (2026-07-28): Types of Products/Base
 * Color di Colour Matching tidak auto-fill dari histori padahal Order-nya
 * sudah pernah diinput -- root cause: kolom JENIS/WARNA DASAR di Master Data
 * Order itu isinya literal "-". */
function cleanPlaceholder(v: string | null): string | null {
  const trimmed = (v ?? "").trim();
  return trimmed === "" || trimmed === "-" ? null : v;
}

export default function OrderLookup({
  value,
  onChange,
  onFound,
  onNotFound,
  bare = false,
  showBatchSearch = false,
  batchValue = "",
  onBatchChange,
}: {
  value: string;
  onChange: (order: string) => void;
  onFound: (data: OrderRefData) => void;
  /** Dipanggil kalau Order yg diketik TIDAK ketemu di Master Data (2026-09-02,
   * instruksi eksplisit user) -- opsional, SENGAJA callback TERPISAH dari
   * `onFound` (bukan memanggil `onFound` dgn data kosong): beberapa pemanggil
   * (mis. "Cari Order" di popup Production Order Monitoring) memaknai
   * `onFound` sbg "Order ini BENERAN ada, lakukan aksi" (buka modal detail),
   * jadi tidak aman dipanggil jg saat GAGAL. Konsumen yg cuma isi field form
   * biasa (pola `data.field ?? ""`, mayoritas pemanggil komponen ini) aman &
   * dianjurkan pasang ini utk kosongkan field2 turunannya (Material
   * Number/Description/dst) supaya tidak ada data BASI dari lookup
   * SEBELUMNYA yg nempel begitu Order diedit jadi tidak valid lagi (bug
   * ditemukan 2026-09-02: field lain dibiarkan apa adanya walau Order sudah
   * berubah/tidak ketemu). Konsumen yg TIDAK pasang ini otomatis tetap
   * berperilaku spt sebelumnya (tidak ada perubahan). */
  onNotFound?: () => void;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  /** Tambahkan field "Batch" di sebelah Order, dgn pencarian SALING FALLBACK
   * ke tipe satunya (2026-11-04, instruksi eksplisit user, awalnya dibangun
   * utk menu "QR Code Yamaha" yg sekarang digabung ke Label Entry FG) --
   * operator kadang cuma pegang No Batch fisik (bukan No PO), dan sebaliknya.
   * Default false (SEMUA pemanggil lain komponen ini TIDAK berubah). Kalau
   * `true`, WAJIB pasang `batchValue`/`onBatchChange` juga (controlled, sama
   * pola dgn `value`/`onChange` Order). */
  showBatchSearch?: boolean;
  batchValue?: string;
  onBatchChange?: (batch: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");

  function applyFound(data: OrderRefData) {
    onChange(data.order);
    onBatchChange?.(data.batch ?? "");
    setError("");
    setBatchError("");
    onFound({
      ...data,
      jenis: cleanPlaceholder(data.jenis),
      warnaDasar: cleanPlaceholder(data.warnaDasar),
      volume: cleanPlaceholder(data.volume),
    });
  }

  /** Cari lewat kolom Order -- kalau showBatchSearch & No PO yg diketik tidak
   * ketemu, coba lagi sbg No Batch (fallback) sblm benar2 dianggap gagal. */
  async function handleSearch() {
    const order = value.trim();
    if (!order) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(order)}`);
      applyFound(res.data);
    } catch (err) {
      if (showBatchSearch) {
        try {
          const res2 = await api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/by-batch/${encodeURIComponent(order)}`);
          applyFound(res2.data);
          return;
        } catch {
          /* bukan No Batch jg -- lanjut tampilkan error Order di bawah */
        }
      }
      setError(err instanceof ApiError ? err.message : "Order tidak ditemukan.");
      onNotFound?.();
    } finally {
      setLoading(false);
    }
  }

  /** Cari lewat kolom Batch -- simetris dgn handleSearch, fallback ke Order kalau gagal. */
  async function handleBatchSearch() {
    const batch = batchValue.trim();
    if (!batch) return;
    setBatchLoading(true);
    setBatchError("");
    try {
      const res = await api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/by-batch/${encodeURIComponent(batch)}`);
      applyFound(res.data);
    } catch {
      try {
        const res2 = await api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(batch)}`);
        applyFound(res2.data);
      } catch (err2) {
        setBatchError(err2 instanceof ApiError ? err2.message : "Batch/Order tidak ditemukan.");
        onNotFound?.();
      }
    } finally {
      setBatchLoading(false);
    }
  }

  const input = (
    <input
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        // Ketikan berubah -- error lookup lama (kalau ada) sudah tidak
        // relevan lagi, biar border merahnya tidak nyangkut menunjuk teks
        // yg sudah berubah (2026-09-02, bareng fix onFound "kosong" di atas).
        if (error) setError("");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSearch();
        }
      }}
      onBlur={handleSearch}
      placeholder="Ketik nomor Order, lalu tekan Enter"
      required
      style={error ? { borderColor: "var(--danger)", background: "#fef2f2" } : undefined}
      title={error || undefined}
    />
  );

  if (bare) {
    return input;
  }

  if (!showBatchSearch) {
    return (
      <div className="field">
        <label>Order</label>
        {input}
        {loading && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Mencari...</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <div className="field" style={{ flex: "1 1 180px" }}>
        <label>Order</label>
        {input}
        {loading && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Mencari...</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
      <div className="field" style={{ flex: "1 1 180px" }}>
        <label title="Alternatif kalau No PO tidak diketahui -- isi No Batch saja">Batch</label>
        <input
          value={batchValue}
          onChange={(e) => {
            onBatchChange?.(e.target.value);
            if (batchError) setBatchError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleBatchSearch();
            }
          }}
          onBlur={handleBatchSearch}
          placeholder="Ketik No Batch, lalu tekan Enter"
          style={batchError ? { borderColor: "var(--danger)", background: "#fef2f2" } : undefined}
          title={batchError || undefined}
        />
        {batchLoading && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Mencari...</span>}
        {batchError && <span className="error-text">{batchError}</span>}
      </div>
    </div>
  );
}
