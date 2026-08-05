import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { SpecVerdict, SPEC_VERDICT_LABEL, SPEC_VERDICT_COLOR } from "../../lib/specEval";

interface QualityReviewRow {
  checkId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  customer: string | null;
  itemCheck: string;
  spec: string | null;
  result: string | null;
  verdict: SpecVerdict;
  pic: string | null;
  inputBy: string;
}

interface QualityReviewData {
  summary: { ok: number; okLower: number; okCenter: number; okUpper: number; ng: number; unknown: number; total: number };
  rows: QualityReviewRow[];
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/**
 * Dashboard > Quality Check Review (2026-08-05, instruksi eksplisit user) --
 * rekap SEMUA item Spec Parameter dari histori Input Check Results (lintas
 * Order/Material), dihitung berapa item verdict-nya OK vs NG, ditambah tabel
 * detail per-item (bisa difilter/cari lewat DataTable bawaan). Filter tanggal
 * (From/To, berdasar Timestamp Check Results) opsional -- default tampilkan
 * semua data.
 */
export default function QualityCheckReviewPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useQuery({
    queryKey: ["quality-check-review", from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      // "To" inklusif seharian penuh -- input cuma tanggal (bukan jam), jadi
      // digenapkan ke akhir hari (23:59:59) sebelum dikirim ke backend.
      if (to) params.set("to", `${to}T23:59:59`);
      const qs = params.toString();
      return api.get<{ success: boolean; data: QualityReviewData }>(`/dashboard/quality-check-review${qs ? `?${qs}` : ""}`).then((r) => r.data);
    },
  });

  const summary = query.data?.summary ?? { ok: 0, okLower: 0, okCenter: 0, okUpper: 0, ng: 0, unknown: 0, total: 0 };
  const rows = query.data?.rows ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total Item Dicek" value={summary.total} color="var(--navy-light)" />
        <KpiCard label="OK" value={summary.ok} color="var(--success, #22c55e)" />
        <KpiCard label="OK Lower" value={summary.okLower} color="#22c55e" />
        <KpiCard label="OK Center" value={summary.okCenter} color="#22c55e" />
        <KpiCard label="OK Upper" value={summary.okUpper} color="#22c55e" />
        <KpiCard label="NG" value={summary.ng} color="var(--danger, #ef4444)" />
        <KpiCard label="On Check" value={summary.unknown} color="var(--text-muted, #999)" />
      </div>

      <div className="panel">
        <div className="panel-header">Quality Check Review</div>
        <div className="panel-body">
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Rekap seluruh item Spec Parameter dari histori menu Input Check Results, dibandingkan otomatis dengan
            Standard/Spec masing-masing untuk menentukan verdict (logika sama seperti kolom "Verdict" di History
            Input Check Results). Untuk Spec berupa rentang (mis. "40-45"), OK dipecah jadi OK Lower/OK Center/OK
            Upper tergantung Result condong ke batas bawah, tengah, atau atas rentang. Item dengan Result kosong atau
            format Spec tidak dikenali dihitung sebagai "On Check", bukan OK maupun NG.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
            <div className="field" style={{ maxWidth: 180 }}>
              <label>Dari Tanggal</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ maxWidth: 180 }}>
              <label>Sampai Tanggal</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {(from || to) && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Reset Tanggal
              </button>
            )}
          </div>

          <DataTable
            rowKey={(r: QualityReviewRow) => `${r.checkId}-${r.itemCheck}`}
            exportFileName="quality-check-review"
            storageKey="quality-check-review"
            rows={rows}
            freezeFirstColumn
            emptyMessage={query.isLoading ? "Memuat..." : "Belum ada data Check Results pada rentang ini."}
            columns={[
              {
                key: "timestamp",
                label: "Timestamp",
                render: (r) => formatDateTime(r.timestamp),
                csvValue: (r) => toExcelDateTimeString(r.timestamp),
              },
              { key: "order", label: "Order", render: (r) => r.order },
              { key: "batch", label: "Batch", render: (r) => r.batch ?? "-" },
              { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription ?? "-" },
              { key: "customer", label: "Customer", render: (r) => r.customer ?? "-" },
              { key: "itemCheck", label: "Item Check", render: (r) => r.itemCheck },
              { key: "spec", label: "Spec", render: (r) => r.spec || "-" },
              { key: "result", label: "Result", render: (r) => r.result || "-" },
              {
                key: "verdict",
                label: "Verdict",
                render: (r) => (
                  <span
                    style={{
                      background: SPEC_VERDICT_COLOR[r.verdict],
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      display: "inline-block",
                    }}
                  >
                    {SPEC_VERDICT_LABEL[r.verdict]}
                  </span>
                ),
                csvValue: (r) => SPEC_VERDICT_LABEL[r.verdict],
              },
              { key: "pic", label: "PIC", render: (r) => r.pic ?? "-" },
              { key: "inputBy", label: "Input By", render: (r) => r.inputBy },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
