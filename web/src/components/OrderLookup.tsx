import { useState } from "react";
import { api, ApiError } from "../api/client";

export interface OrderRefData {
  order: string;
  batch: string | null;
  materialNumber: string | null;
  materialDescription: string | null;
  orderQty: string | null;
  plant: string | null;
  /// Kolom "JENIS" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Types of Products" di Colour Matching.
  jenis: string | null;
  /// Kolom "WARNA DASAR" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Base Color" di Colour Matching.
  warnaDasar: string | null;
  /// Kolom "Volume" di Referensi Order/PO (SAP-COOISPI) -- dipakai utk saran "Volume" di Packing.
  volume: string | null;
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
      onFound(res.data);
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
