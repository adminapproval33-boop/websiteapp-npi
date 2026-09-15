import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import {
  formatInputBy,
  useEmployeeOptions,
  normalizeMembers,
  displayNameWithNik,
  resolveEmployeeId,
  MemberEntry,
} from "../../components/EmployeeNameSelect";
import { formatDateTime, toExcelDateTimeString } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";
import ColourMatchingPage from "../ColourMatching/ColourMatchingPage";

/** Baris "History Colour Matching" -- SAMA PERSIS shape-nya dgn HistoryRow di
 * ColourMatchingPage.tsx (lihat GET /dashboard/colour-matching di
 * dashboard.routes.ts, select-nya disamakan field-per-field), supaya tabel di
 * Dashboard ini SAMA PERSIS tampilannya dgn tab History di menu Colour
 * Matching asli (2026-09-11, instruksi eksplisit user) -- termasuk kolom
 * Aksi (Edit/Hapus), lihat komentar di tombol Edit di bawah utk cara Edit-nya
 * bisa dipakai langsung di sini tanpa pindah halaman. */
interface HistoryRow {
  id: number;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string;
  typesOfProducts: string | null;
  baseColor: string | null;
  custSegmen: string | null;
  formPerMan: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string | null;
  spvName: string;
  spvNik: string | null;
  spvColourMatching: string | null;
  spvColourMatchingNik: string | null;
  leaderName: string | null;
  leaderNik: string | null;
  members: (string | MemberEntry)[] | null;
  remark: string | null;
  inputBy: string;
  _count: { attachments: number };
}

/** Baris tab "Dashboard Colour Matching" (2026-09-11, instruksi eksplisit
 * user: nama member + total output/"pendapatan" + jumlah Order yang pernah
 * diproses, urut dari output TERBESAR -- lihat agregasi `members` di
 * dashboard.routes.ts). */
interface MemberRow {
  name: string;
  nik: string | null;
  orderCount: number;
  totalOutputKgLtr: number;
  /** Jumlah Order yg pernah ditangani member ini sbg Spray Man (2026-09-15,
   * instruksi eksplisit user) -- data dari modul Approval, bukan Colour
   * Matching sendiri, dicocokkan lewat NIK/nama yg sama (lihat komentar di
   * dashboard.routes.ts). 0 kalau member ini tidak pernah jadi Spray Man. */
  sprayManOrderCount: number;
}

interface ColourMatchingDashboardData {
  from: string | null;
  to: string | null;
  filterOptions: {
    spvOptions: string[];
    leaderOptions: string[];
    typesOfProductsOptions: string[];
    baseColorOptions: string[];
    custSegmenOptions: string[];
  };
  summary: {
    totalOrderCount: number;
    okeCount: number;
    waitCount: number;
  };
  members: MemberRow[];
  historyRows: HistoryRow[];
}

const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 180px", padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
    </div>
  );
}

/** Dropdown filter "Semua <label>" + opsi (2026-09-11, instruksi eksplisit
 * user: filter by SPV Colour Matching/Leader/Types of Products/Base Color).
 * Bisa pilih lebih dari 1 nilai sekaligus (2026-09-15, instruksi eksplisit
 * user, mis. Leader "Moh Soleh" DAN "Rojalih" bareng) -- nilai yg sudah
 * dipilih tampil sbg tag di bawah kotak ketik, kotak ketiknya sendiri tetap
 * bisa dipakai cari/pilih nilai berikutnya (datalist, pola sama dgn
 * TankSelect/CustomerSelect di komponen lain). */
function FilterSelect({
  label,
  values,
  onChange,
  options,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [inputValue, setInputValue] = useState("");
  const inputId = `filter-select-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const listId = `${inputId}-options`;
  const availableOptions = options.filter((o) => !values.includes(o));

  function addValue(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setInputValue("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, position: "relative" }}>
      <label htmlFor={inputId} style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)" }}>
        {label}
      </label>
      <input
        id={inputId}
        list={listId}
        className="btn btn-outline"
        value={inputValue}
        onChange={(e) => {
          const v = e.target.value;
          // Cocok persis salah satu opsi (dipilih dari datalist, atau
          // diketik pas) -- langsung jadi tag & kotak dikosongkan lagi
          // supaya siap pilih nilai berikutnya.
          if (options.includes(v)) addValue(v);
          else setInputValue(v);
        }}
        placeholder={values.length > 0 ? "+ Tambah lagi..." : `Semua ${label}`}
        autoComplete="off"
      />
      <datalist id={listId}>
        {availableOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {values.length > 0 && (
        // position: absolute (2026-09-15, instruksi eksplisit user: baris
        // toolbar jangan berantakan saat filter aktif) -- tag2 SENGAJA tidak
        // ikut dihitung tinggi oleh flex row toolbar (DataTable.tsx), supaya
        // tombol Kolom/Filter/Reset di sebelahnya tidak ikut terdorong turun
        // cuma krn 1 filter ini py banyak pilihan.
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            zIndex: 5,
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            maxWidth: 220,
            background: "var(--panel-bg, #fff)",
            padding: 2,
            borderRadius: 6,
          }}
        >
          {values.map((v) => (
            <span
              key={v}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 999,
                padding: "1px 6px 1px 8px",
                fontSize: "0.72rem",
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Hapus ${v}`}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--text-muted)" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard > Colour Matching -- 2 tab (2026-09-11, instruksi eksplisit
 * user): "Dashboard Colour Matching" (agregasi per-member: Total Output &
 * Jumlah Order, urut output tertinggi) dan "Colour Matching Review" (KPI
 * Total Order/Oke/Wait + tabel "History Colour Matching", SAMA PERSIS
 * kolomnya dgn tab History di menu Colour Matching asli, minus Aksi bawaan
 * -- edit/hapus tetap ada lewat pop-up sendiri). SEMUA diturunkan dari
 * histori ColourMatchingLog (1 query yg sama, filter tanggal/SPV/Leader/
 * Types of Products/Base Color dipakai bareng oleh kedua tab), bukan dari
 * Master Data Karyawan -- jadi otomatis update setiap ada input baru.
 *
 * (2026-09-10: rilis awal cuma 1 tampilan, kartu Jumlah SPV/Leader/Member +
 * tabel agregasi "Output & Ekspertise Member". 2026-09-11: KPI diganti ke
 * Total Order/Oke/Wait, tabel diganti jadi History. Revisi ke-2 hari yg
 * sama: dipecah jadi 2 tab, agregasi per-member dikembalikan lagi sbg tab
 * terpisah "Dashboard Colour Matching".)
 */
export default function ColourMatchingDashboardPage() {
  const { user } = useAuth();
  const canDelete = getMenuLevel(user, "colourMatching") === "INPUT";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"member" | "review">("member");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [spv, setSpv] = useState<string[]>([]);
  const [leader, setLeader] = useState<string[]>([]);
  const [typesOfProducts, setTypesOfProducts] = useState<string[]>([]);
  const [baseColor, setBaseColor] = useState<string[]>([]);
  const [custSegmen, setCustSegmen] = useState<string[]>([]);
  // Baris yg sedang di-Edit (2026-09-11, instruksi eksplisit user: tombol
  // Edit langsung dari Dashboard) -- di-snapshot ke state saat tombol Edit
  // diklik (BUKAN diturunkan langsung dari `historyRows` tiap render), supaya
  // refetch React Query di belakang layar (mis. sesudah filter berubah)
  // tidak mereset form yg sedang diisi user di dalam modal.
  const [editRow, setEditRow] = useState<HistoryRow | null>(null);

  const query = useQuery({
    queryKey: [
      "dashboard-colour-matching",
      customFrom,
      customTo,
      spv.join(","),
      leader.join(","),
      typesOfProducts.join(","),
      baseColor.join(","),
      custSegmen.join(","),
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
      if (spv.length) params.set("spv", spv.join(","));
      if (leader.length) params.set("leader", leader.join(","));
      if (typesOfProducts.length) params.set("typesOfProducts", typesOfProducts.join(","));
      if (baseColor.length) params.set("baseColor", baseColor.join(","));
      if (custSegmen.length) params.set("custSegmen", custSegmen.join(","));
      return api
        .get<{ success: boolean; data: ColourMatchingDashboardData }>(`/dashboard/colour-matching?${params.toString()}`)
        .then((r) => r.data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/colour-matching/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard-colour-matching"] }),
    onError: (err) => window.alert(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const employeesQuery = useEmployeeOptions();
  const employees = employeesQuery.data;

  const summary = query.data?.summary;
  const members = query.data?.members ?? [];
  const historyRows = query.data?.historyRows ?? [];
  const filterOptions = query.data?.filterOptions;
  const hasActiveFilter = !!(
    customFrom ||
    customTo ||
    spv.length ||
    leader.length ||
    typesOfProducts.length ||
    baseColor.length ||
    custSegmen.length
  );

  // Toolbar filter (2026-09-11, instruksi eksplisit user) -- dipakai di KEDUA
  // tab (Dashboard Colour Matching & Colour Matching Review) krn keduanya
  // baca dari query/state filter yang SAMA, jadi filter yang diubah di tab
  // manapun otomatis kepakai juga di tab satunya.
  const filterToolbar = (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label htmlFor="colour-matching-dashboard-start" style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)" }}>
          Start
        </label>
        <input id="colour-matching-dashboard-start" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label htmlFor="colour-matching-dashboard-finish" style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)" }}>
          Finish
        </label>
        <input id="colour-matching-dashboard-finish" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
      </div>
      <FilterSelect label="SPV Colour Matching" values={spv} onChange={setSpv} options={filterOptions?.spvOptions ?? []} />
      <FilterSelect label="Leader" values={leader} onChange={setLeader} options={filterOptions?.leaderOptions ?? []} />
      <FilterSelect
        label="Types of Products"
        values={typesOfProducts}
        onChange={setTypesOfProducts}
        options={filterOptions?.typesOfProductsOptions ?? []}
      />
      <FilterSelect label="Base Color" values={baseColor} onChange={setBaseColor} options={filterOptions?.baseColorOptions ?? []} />
      <FilterSelect label="Cust Segmen" values={custSegmen} onChange={setCustSegmen} options={filterOptions?.custSegmenOptions ?? []} />
      {hasActiveFilter && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setCustomFrom("");
            setCustomTo("");
            setSpv([]);
            setLeader([]);
            setTypesOfProducts([]);
            setBaseColor([]);
            setCustSegmen([]);
          }}
        >
          Reset (Semua Histori)
        </button>
      )}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "member" ? "" : "btn-outline"}`} onClick={() => setTab("member")}>
          Dashboard Colour Matching
        </button>
        <button className={`btn ${tab === "review" ? "" : "btn-outline"}`} onClick={() => setTab("review")}>
          Colour Matching Review
        </button>
      </div>

      {tab === "member" && (
        <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total Order" value={String(summary?.totalOrderCount ?? 0)} color="var(--navy-light)" />
        <KpiCard label="Oke Colour Matching" value={String(summary?.okeCount ?? 0)} color="var(--success)" />
        <KpiCard label="Wait Colour Matching" value={String(summary?.waitCount ?? 0)} color="#E74C3C" />
        <KpiCard label="Member" value={String(members.length)} color="var(--info)" />
      </div>

        <div className="panel">
          <div className="panel-header">Dashboard Colour Matching</div>
          <div className="panel-body">
            <DataTable
              rowKey={(r: MemberRow) => r.nik ?? r.name}
              exportFileName="dashboard-colour-matching-member"
              storageKey="dashboard-colour-matching-member"
              rows={members}
              freezeFirstColumn
              emptyMessage="Belum ada data Colour Matching pada rentang tanggal ini."
              toolbarSecondRow={filterToolbar}
              columns={[
                { key: "name", label: "Nama Member", render: (r) => r.name },
                { key: "nik", label: "NIK", render: (r) => r.nik ?? "-" },
                { key: "orderCount", label: "Jumlah Order", render: (r) => numberFmt.format(r.orderCount), csvValue: (r) => r.orderCount },
                {
                  key: "totalOutputKgLtr",
                  label: "Total Output (KG/Ltr)",
                  render: (r) => numberFmt.format(r.totalOutputKgLtr),
                  csvValue: (r) => r.totalOutputKgLtr,
                },
                {
                  key: "sprayManOrderCount",
                  label: "Jumlah Order (Spray Man)",
                  render: (r) => numberFmt.format(r.sprayManOrderCount),
                  csvValue: (r) => r.sprayManOrderCount,
                },
              ]}
            />
          </div>
        </div>
        </>
      )}

      {tab === "review" && (
        <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Total Order" value={String(summary?.totalOrderCount ?? 0)} color="var(--navy-light)" />
        <KpiCard label="Oke Colour Matching" value={String(summary?.okeCount ?? 0)} color="var(--success)" />
        <KpiCard label="Wait Colour Matching" value={String(summary?.waitCount ?? 0)} color="#E74C3C" />
        <KpiCard label="Member" value={String(members.length)} color="var(--info)" />
      </div>

      <div className="panel">
        <div className="panel-header">History Colour Matching</div>
        <div className="panel-body">
          <DataTable
            rowKey={(r: HistoryRow) => r.id}
            exportFileName="dashboard-colour-matching-history"
            storageKey="dashboard-colour-matching-history"
            rows={historyRows}
            freezeFirstColumn
            emptyMessage="Belum ada data Colour Matching pada rentang tanggal ini."
            toolbarSecondRow={filterToolbar}
            columns={[
              {
                key: "timestamp",
                label: "Timestamp",
                render: (r) => formatDateTime(r.timestamp),
                csvValue: (r) => toExcelDateTimeString(r.timestamp),
              },
              { key: "order", label: "Order", render: (r) => r.order },
              { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
              { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
              { key: "batch", label: "Batch", render: (r) => r.batch },
              { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
              { key: "plant", label: "Plant", render: (r) => r.plant },
              { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
              { key: "spvName", label: "SPV Produksi", render: (r) => r.spvName },
              { key: "spvEmployeeId", label: "SPV Employee ID", render: (r) => resolveEmployeeId(employees, r.spvName, r.spvNik) },
              { key: "spvColourMatching", label: "SPV Colour Matching", render: (r) => r.spvColourMatching },
              {
                key: "spvColourMatchingEmployeeId",
                label: "SPV Colour Matching Employee ID",
                render: (r) => resolveEmployeeId(employees, r.spvColourMatching, r.spvColourMatchingNik),
              },
              { key: "leaderName", label: "Leader", render: (r) => r.leaderName },
              {
                key: "leaderEmployeeId",
                label: "Leader Employee ID",
                render: (r) => resolveEmployeeId(employees, r.leaderName, r.leaderNik),
              },
              {
                key: "members",
                label: "Member",
                render: (r) => {
                  const members = normalizeMembers(r.members);
                  const list = members.map((m) => displayNameWithNik(employees, m.name, m.nik));
                  return [String(members.length), ...list].join(" | ");
                },
              },
              { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
              { key: "typesOfProducts", label: "Types of Products", render: (r) => r.typesOfProducts },
              { key: "baseColor", label: "Base Color", render: (r) => r.baseColor },
              { key: "custSegmen", label: "Cust Segmen", render: (r) => r.custSegmen },
              {
                key: "formReceived",
                label: "Form Received",
                render: (r) => (r.formReceived ? formatDateTime(r.formReceived) : ""),
                csvValue: (r) => (r.formReceived ? toExcelDateTimeString(r.formReceived) : ""),
              },
              {
                key: "start",
                label: "Start",
                render: (r) => formatDateTime(r.start),
                csvValue: (r) => toExcelDateTimeString(r.start),
              },
              {
                key: "finish",
                label: "Finish",
                render: (r) => formatDateTime(r.finish),
                csvValue: (r) => toExcelDateTimeString(r.finish),
              },
              { key: "formPerMan", label: "Form/Man", render: (r) => r.formPerMan },
              { key: "remark", label: "Remark", render: (r) => r.remark },
              { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
              { key: "attachments", label: "Lampiran", render: (r) => (r._count.attachments ? `${r._count.attachments} file` : "-") },
              {
                key: "actions",
                label: "Aksi",
                render: (r) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-outline"
                      type="button"
                      title="Edit"
                      aria-label="Edit"
                      style={{ padding: "6px 10px" }}
                      onClick={() => setEditRow(r)}
                    >
                      ✏️
                    </button>
                    {canDelete && (
                      <button
                        className="btn btn-danger"
                        type="button"
                        title="Hapus"
                        aria-label="Hapus"
                        style={{ padding: "6px 10px" }}
                        onClick={() => {
                          if (confirm(`Hapus data Colour Matching untuk Order ${r.order}?`)) deleteMutation.mutate(r.id);
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                ),
                csvValue: () => "",
              },
            ]}
          />
        </div>
      </div>

      {editRow && (
        <Modal
          title={`Edit Colour Matching — Order ${editRow.order}`}
          onClose={() => setEditRow(null)}
          width={980}
          closeOnBackdropClick={false}
        >
          {/* `embedded` + `editRecord` (2026-09-11, instruksi eksplisit user)
              -- reuse form Input Colour Matching yang sama persis dgn menu
              Colour Matching asli, langsung masuk mode Edit dari snapshot
              baris ini (bukan lookup ulang ke Master Data Order), supaya
              Order lama yg sudah tidak ada lagi di Master Data Order tetap
              bisa diedit dgn benar. Hasil Save tetap masuk ke tabel
              ColourMatchingLog yang sama, jadi otomatis muncul juga di tab
              History menu Colour Matching maupun tabel di atas. */}
          <ColourMatchingPage
            embedded
            editRecord={editRow}
            onSaved={() => {
              setEditRow(null);
              queryClient.invalidateQueries({ queryKey: ["dashboard-colour-matching"] });
            }}
          />
        </Modal>
      )}
        </>
      )}
    </div>
  );
}
