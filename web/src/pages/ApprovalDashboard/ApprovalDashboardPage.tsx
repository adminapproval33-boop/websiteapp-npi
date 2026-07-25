import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

interface DashboardSummary {
  ageBuckets: { lt7: number; d7_14: number; d14_30: number; gt30: number };
  totalApprovalPeriode: number;
  totalFinishPeriode: number;
  byTechName: { label: string; count: number }[];
  byPlant: { label: string; count: number }[];
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

function BarList({ title, data }: { title: string; data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="panel" style={{ flex: "1 1 320px" }}>
      <div className="panel-header">{title}</div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.length === 0 && <span style={{ color: "var(--text-muted)" }}>Tidak ada data terbuka.</span>}
        {data.map((d) => (
          <div key={d.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 3 }}>
              <span>{d.label}</span>
              <span style={{ fontWeight: 600 }}>{d.count}</span>
            </div>
            <div style={{ background: "var(--app-bg)", borderRadius: 4, height: 10, overflow: "hidden" }}>
              <div style={{ width: `${(d.count / max) * 100}%`, background: "var(--navy-light)", height: "100%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ApprovalDashboardPage() {
  const [start, setStart] = useState("");
  const [finish, setFinish] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["approval-dashboard", start, finish],
    queryFn: () => {
      const qs = new URLSearchParams({ start, finish }).toString();
      return api.get<{ success: boolean; data: DashboardSummary }>(`/approvals/dashboard/summary?${qs}`).then((r) => r.data);
    },
  });

  const data = summaryQuery.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel">
        <div className="panel-header">Filter Periode</div>
        <div className="panel-body field-grid">
          <div className="field">
            <label>Dari Tanggal</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label>Sampai Tanggal</label>
            <input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} />
          </div>
        </div>
      </div>

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard label="Finish < 7 hari" value={data.ageBuckets.lt7} color="var(--success)" />
            <KpiCard label="Finish 7-14 hari" value={data.ageBuckets.d7_14} color="var(--info)" />
            <KpiCard label="Finish 14-30 hari" value={data.ageBuckets.d14_30} color="var(--navy-light)" />
            <KpiCard label="Finish > 30 hari" value={data.ageBuckets.gt30} color="var(--danger)" />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard label="Total Approval (periode)" value={data.totalApprovalPeriode} color="var(--navy)" />
            <KpiCard label="Total Finish (periode)" value={data.totalFinishPeriode} color="var(--navy)" />
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <BarList title="Approval Terbuka — by Tech Name" data={data.byTechName} />
            <BarList title="Approval Terbuka — by Plant" data={data.byPlant} />
          </div>
        </>
      )}

      {summaryQuery.isLoading && <p>Memuat...</p>}
    </div>
  );
}
