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
  bare = false,
}: {
  value: string;
  onChange: (order: string) => void;
  onFound: (data: OrderRefData) => void;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch() {
    const order = value.trim();
    if (!order) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(order)}`);
      onFound({
        ...res.data,
        jenis: cleanPlaceholder(res.data.jenis),
        warnaDasar: cleanPlaceholder(res.data.warnaDasar),
        volume: cleanPlaceholder(res.data.volume),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Order tidak ditemukan.");
    } finally {
      setLoading(false);
    }
  }

  const input = (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSearch();
        }
      }}
      onBlur={handleSearch}
      placeholder="Ketik nomor Order, lalu tekan Enter"
      required
    />
  );

  if (bare) {
    return input;
  }

  return (
    <div className="field">
      <label>Order</label>
      {input}
      {loading && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Mencari...</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
