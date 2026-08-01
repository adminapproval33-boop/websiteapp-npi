import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import ProcessBadge from "../../components/ProcessBadge";
import { formatDateTime } from "../../lib/datetime";
import { evaluateSpec, SPEC_VERDICT_COLOR, SPEC_VERDICT_LABEL } from "../../lib/specEval";
import TankManualInputTab from "./TankManualInputTab";

interface TankOccupant {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  pctGR: string | null;
  orderType: string | null;
  remark: string | null;
  process: string;
  start: string | null;
  finish: string | null;
  since: string;
  /** Label Proses Packing, TERPISAH dari `process` -- sesuai instruksi
   * eksplisit user (2026-07-28). */
  productionActions: string | null;
  /** "Input Admin" = okupansi dihitung otomatis dari histori proses biasa.
   * "Manual" = okupansi ini dari tab "Input Manual" -- `process`/
   * `productionActions` di atas TETAP logika otomatis Order ybs walau
   * sumbernya manual (2026-07-31, instruksi eksplisit user). */
  source: "Input Admin" | "Manual";
}

interface TankRow {
  code: string;
  taTb: string | null;
  tankCapacity: string | null;
  newNumber: string | null;
  locationPlant: string | null;
  typeTanki: string | null;
  status: "occupied" | "empty";
  occupant: TankOccupant | null;
}

interface QcParamDetail {
  no: number;
  parameter: string;
  standard: string | null;
  result: string | null;
  start: string | null;
  finish: string | null;
}

interface QcCheckDetail {
  checkId: string;
  order: string;
  parameters: QcParamDetail[];
}

interface StageLeadTime {
  process: string;
  start: string | null;
  finish: string | null;
  leadTimeHariKerja: number | null;
}

interface ProcessRemark {
  process: string;
  remark: string | null;
  timestamp: string;
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/** "2 hari 5 jam" sejak `since` sampai sekarang -- format sama gayanya dgn
 * Processing Time di Approval Lot History, tapi dihitung di client krn
 * datanya cuma dipakai tampilan (tidak perlu query ulang tiap detik). */
function formatDuration(since: string): string {
  const ms = Math.max(0, Date.now() - new Date(since).getTime());
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0 && hours === 0) return "< 1 jam";
  return `${days} hari ${hours} jam`;
}

export default function TankDashboardPage() {
  const [tab, setTab] = useState<"monitoring" | "manual">("monitoring");
  const [search, setSearch] = useState("");
  const [qcDetailOrder, setQcDetailOrder] = useState<string | null>(null);
  const [remarkDetailOrder, setRemarkDetailOrder] = useState<string | null>(null);
  const [leadTimeDetailOrder, setLeadTimeDetailOrder] = useState<string | null>(null);

  const tankQuery = useQuery({
    queryKey: ["tank-status"],
    queryFn: () => api.get<{ success: boolean; data: TankRow[] }>("/dashboard/tank-status").then((r) => r.data),
    refetchInterval: 30_000,
  });

  // 3 popup ini reuse endpoint yang SAMA dgn Dashboard Production Order
  // Monitoring (per Order, bukan per Tank) -- supaya datanya konsisten &
  // tidak perlu endpoint baru di backend.
  const qcDetailQuery = useQuery({
    queryKey: ["tank-qc-detail", qcDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: QcCheckDetail | null }>(`/check-results/by-order/${encodeURIComponent(qcDetailOrder!)}`)
        .then((r) => r.data),
    enabled: qcDetailOrder != null,
  });

  const remarkDetailQuery = useQuery({
    queryKey: ["tank-remark-detail", remarkDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ProcessRemark[] }>(
          `/dashboard/production-orders/${encodeURIComponent(remarkDetailOrder!)}/remarks`
        )
        .then((r) => r.data),
    enabled: remarkDetailOrder != null,
  });

  const leadTimeDetailQuery = useQuery({
    queryKey: ["tank-lead-time-detail", leadTimeDetailOrder],
    queryFn: () =>
      api
        .get<{ success: boolean; data: StageLeadTime[] }>(
          `/dashboard/production-orders/${encodeURIComponent(leadTimeDetailOrder!)}/stage-lead-times`
        )
        .then((r) => r.data),
    enabled: leadTimeDetailOrder != null,
  });

  const rows = tankQuery.data ?? [];
  const occupiedCount = rows.filter((r) => r.status === "occupied").length;
  const emptyCount = rows.length - occupiedCount;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const haystack = [r.code, r.occupant?.order, r.occupant?.materialNumber, r.occupant?.materialDescription, r.occupant?.batch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "monitoring" ? "" : "btn-outline"}`} onClick={() => setTab("monitoring")}>
          Monitoring Tanki
        </button>
        <button className={`btn ${tab === "manual" ? "" : "btn-outline"}`} onClick={() => setTab("manual")}>
          Input Manual
        </button>
      </div>

      {tab === "manual" && <TankManualInputTab />}

      {tab === "monitoring" && (
        <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total Tank" value={rows.length} color="var(--navy-light)" />
        <KpiCard label="Tank Kosong" value={emptyCount} color="var(--success)" />
        <KpiCard label="Tank Terisi" value={occupiedCount} color="var(--danger)" />
      </div>

      <div className="panel">
        <div className="panel-header">Tank Monitoring</div>
        <div className="panel-body">
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Status "Terisi"/"Kosong" diturunkan otomatis dari Code Tanki yang diisi di menu Premix, Milling, Aftermix,
            Colour Matching, QC, Approval, dan Packing -- diambil dari input PALING TERAKHIR untuk tiap Tank (lintas
            Order manapun), dan dianggap kosong lagi begitu Order tersebut sudah masuk Packing. Data ini bukan sensor
            fisik, jadi bisa saja tidak 100% akurat kalau ada tahap yang belum diinput ke sistem.
          </p>
          <input
            placeholder="Cari Code Tanki / Order / Material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
          />
          <p style={{ marginTop: 0, marginBottom: 12, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Kolom <strong>Code Tanki</strong> di-freeze (tetap kelihatan saat scroll ke samping), dan Header tabel
            selalu freeze ke atas saat scroll ke bawah -- mirip Freeze Panes di Excel.
          </p>
          <DataTable
            rowKey={(r: TankRow) => r.code}
            exportFileName="tank-monitoring"
            storageKey="tank-monitoring"
            rows={filteredRows}
            freezeFirstColumn
            rowStyle={(r) => (r.status === "occupied" ? { background: "#fef2f2" } : undefined)}
            columns={[
              { key: "code", label: "Code Tanki", render: (r) => r.code },
              { key: "typeTanki", label: "Tank Type", render: (r) => r.typeTanki || "-" },
              { key: "tankCapacity", label: "Kapasitas", render: (r) => r.tankCapacity || "-" },
              { key: "locationPlant", label: "Lokasi", render: (r) => r.locationPlant || "-" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      background: r.status === "occupied" ? "#fbd6d6" : "#d4f4dd",
                      color: r.status === "occupied" ? "#991b1b" : "#065f46",
                    }}
                  >
                    {r.status === "occupied" ? "Terisi" : "Kosong"}
                  </span>
                ),
                csvValue: (r) => (r.status === "occupied" ? "Terisi" : "Kosong"),
              },
              {
                key: "source",
                label: "Sumber Data",
                render: (r) =>
                  r.occupant ? (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 10px",
                        borderRadius: 999,
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        background: r.occupant.source === "Manual" ? "#f3e8ff" : "#dbeafe",
                        color: r.occupant.source === "Manual" ? "#6b21a8" : "#1e40af",
                      }}
                    >
                      {r.occupant.source}
                    </span>
                  ) : (
                    "-"
                  ),
                csvValue: (r) => r.occupant?.source ?? "-",
              },
              { key: "order", label: "Order", render: (r) => r.occupant?.order || "-" },
              { key: "materialNumber", label: "Material Number", render: (r) => r.occupant?.materialNumber || "-" },
              { key: "materialDescription", label: "Material Description", render: (r) => r.occupant?.materialDescription || "-" },
              { key: "batch", label: "Batch", render: (r) => r.occupant?.batch || "-" },
              { key: "orderType", label: "Order Type", render: (r) => r.occupant?.orderType || "-" },
              { key: "orderQty", label: "Qty/Liter", render: (r) => r.occupant?.orderQty || "-" },
              { key: "pctGR", label: "% GR", render: (r) => r.occupant?.pctGR || "-" },
              {
                key: "process",
                label: "Proses",
                render: (r) => (r.occupant ? <ProcessBadge process={r.occupant.process} onClick={() => setQcDetailOrder(r.occupant!.order)} /> : "-"),
                csvValue: (r) => r.occupant?.process ?? "-",
              },
              {
                key: "productionActions",
                label: "Production Actions",
                render: (r) => (r.occupant?.productionActions ? <ProcessBadge process={r.occupant.productionActions} /> : "-"),
                csvValue: (r) => r.occupant?.productionActions ?? "-",
              },
              {
                key: "start",
                label: "Start",
                render: (r) =>
                  r.occupant ? (
                    <span
                      onClick={() => setLeadTimeDetailOrder(r.occupant!.order)}
                      title="Klik utk lihat rangkuman Start & Finish di semua tahap"
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                    >
                      {r.occupant.start ? formatDateTime(r.occupant.start) : "-"}
                    </span>
                  ) : (
                    "-"
                  ),
              },
              {
                key: "finish",
                label: "Finish",
                render: (r) =>
                  r.occupant ? (
                    <span
                      onClick={() => setLeadTimeDetailOrder(r.occupant!.order)}
                      title="Klik utk lihat rangkuman Start & Finish di semua tahap"
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                    >
                      {r.occupant.finish ? formatDateTime(r.occupant.finish) : "-"}
                    </span>
                  ) : (
                    "-"
                  ),
              },
              {
                key: "remark",
                label: "Remark",
                render: (r) =>
                  r.occupant ? (
                    <span
                      onClick={() => setRemarkDetailOrder(r.occupant!.order)}
                      title="Klik utk lihat Remark tiap proses untuk Order ini"
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                    >
                      {r.occupant.remark || "-"}
                    </span>
                  ) : (
                    "-"
                  ),
                csvValue: (r) => r.occupant?.remark ?? "-",
              },
              {
                key: "duration",
                label: "Long Time Proses",
                render: (r) =>
                  r.occupant ? (
                    <span
                      onClick={() => setLeadTimeDetailOrder(r.occupant!.order)}
                      title="Klik utk lihat lama proses di tiap tahapan"
                      style={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                    >
                      {formatDuration(r.occupant.since)}
                    </span>
                  ) : (
                    "-"
                  ),
                csvValue: (r) => (r.occupant ? formatDuration(r.occupant.since) : "-"),
              },
            ]}
          />
        </div>
      </div>
        </>
      )}

      {qcDetailOrder && (
        <Modal title={`Detail QC — Order ${qcDetailOrder}`} onClose={() => setQcDetailOrder(null)} width={720}>
          {qcDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!qcDetailQuery.isLoading && !qcDetailQuery.data && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada data Check Results untuk Order ini.</p>
          )}
          {qcDetailQuery.data && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item Check</th>
                    <th>Spec</th>
                    <th>Result</th>
                    <th>Start</th>
                    <th>Finish</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {qcDetailQuery.data.parameters.map((p) => {
                    const verdict = evaluateSpec(p.standard, p.result);
                    return (
                      <tr key={p.no}>
                        <td>{p.parameter}</td>
                        <td>{p.standard || "-"}</td>
                        <td>{p.result || "-"}</td>
                        <td>{formatDateTime(p.start)}</td>
                        <td>{formatDateTime(p.finish)}</td>
                        <td style={{ background: SPEC_VERDICT_COLOR[verdict] }}>{SPEC_VERDICT_LABEL[verdict]}</td>
                      </tr>
                    );
                  })}
                  {qcDetailQuery.data.parameters.length === 0 && (
                    <tr>
                      <td colSpan={6}>Belum ada Item Check.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {leadTimeDetailOrder && (
        <Modal title={`Start & Finish per Tahap — Order ${leadTimeDetailOrder}`} onClose={() => setLeadTimeDetailOrder(null)} width={640}>
          {leadTimeDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!leadTimeDetailQuery.isLoading && (leadTimeDetailQuery.data?.length ?? 0) === 0 && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada tahapan proses yang punya data Start untuk Order ini.</p>
          )}
          {leadTimeDetailQuery.data && leadTimeDetailQuery.data.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proses</th>
                    <th>Start</th>
                    <th>Finish</th>
                    <th>Lead Time</th>
                  </tr>
                </thead>
                <tbody>
                  {leadTimeDetailQuery.data.map((s) => (
                    <tr key={s.process}>
                      <td>{s.process}</td>
                      <td>{formatDateTime(s.start)}</td>
                      <td>{s.finish ? formatDateTime(s.finish) : "Belum selesai"}</td>
                      <td>{s.leadTimeHariKerja} hari kerja</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Lead Time tiap tahapan dihitung hari kerja (Sabtu/Minggu tidak dihitung). Tahapan yang "Belum selesai"
            dihitung sampai hari ini.
          </p>
        </Modal>
      )}

      {remarkDetailOrder && (
        <Modal title={`Remark per Proses — Order ${remarkDetailOrder}`} onClose={() => setRemarkDetailOrder(null)} width={640}>
          {remarkDetailQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Memuat...</p>}
          {!remarkDetailQuery.isLoading && (remarkDetailQuery.data?.length ?? 0) === 0 && (
            <p style={{ color: "var(--text-muted)" }}>Belum ada Remark yang diinput di proses manapun untuk Order ini.</p>
          )}
          {remarkDetailQuery.data && remarkDetailQuery.data.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proses</th>
                    <th>Remark</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {remarkDetailQuery.data.map((r) => (
                    <tr key={r.process}>
                      <td>{r.process}</td>
                      <td>{r.remark || "-"}</td>
                      <td>{formatDateTime(r.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Menampilkan Remark dari SEMUA tahap yang pernah diinput utk Order ini, bukan cuma Remark dari tahap yang
            terakhir menyentuh Tank ini (yang tampil di kolom Remark tabel).
          </p>
        </Modal>
      )}
    </div>
  );
}
