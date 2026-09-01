import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

interface OpenApprovalRow {
  approvalId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  salesPic: string | null;
  prepareProduksi: string | null;
  submitToCustomer: string | null;
  customer: string | null;
  custSegmen: string | null;
  techName: string | null;
  orderType: string | null;
}

interface WorklistItem {
  approvalId: string;
  order: string;
  batch: string;
  plant: string;
  orderType: string;
  customer: string;
  sku: string;
  segment: string;
  qty: number;
  tech: string;
  sales: string;
  days: number;
  bucket: Bucket;
  ready: boolean;
}

const BUCKETS = ["0-10", "11-20", "21-30", "31-40", "41-50", "51-60", ">60"] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_COLOR: Record<Bucket, string> = {
  "0-10": "#059669",
  "11-20": "#65a30d",
  "21-30": "#ca8a04",
  "31-40": "#d97706",
  "41-50": "#ea580c",
  "51-60": "#dc2626",
  ">60": "#b91c1c",
};

function bucketOf(days: number): Bucket {
  if (days <= 10) return "0-10";
  if (days <= 20) return "11-20";
  if (days <= 30) return "21-30";
  if (days <= 40) return "31-40";
  if (days <= 50) return "41-50";
  if (days <= 60) return "51-60";
  return ">60";
}

const UNASSIGNED = "UNASSIGNED";
const AVATAR_COLORS = ["#4f46e5", "#0284c7", "#d97706", "#7c3aed", "#059669", "#ea580c", "#65a30d", "#dc2626"];

function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string) {
  if (name === UNASSIGNED) return "??";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase();
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

type ViewMode = "tech" | "sales" | "customer" | "segment";
// "noown" DIGANTI jadi "notech" (2026-09-01, instruksi eksplisit user) --
// filter Sales PIC kosong TIDAK terpakai (di data real sekarang ini SELALU
// 0, lihat komentar di kartu "No Tech PIC"/"No Sales PIC" di atas), Tech PIC
// kosong yg justru sering kejadian (144 item) makanya filter ini diarahkan
// ke situ.
type ReadyFilter = "ALL" | "ready" | "wip" | "notech";
type OwnerFilter = { role: "tech" | "sales"; name: string } | null;
type SortKey = "plant" | "customer" | "order" | "batch" | "orderType" | "sku" | "qty" | "tech" | "sales" | "days" | "ready";

const LIST_VIEWS: ViewMode[] = ["customer", "segment"];
const VIEW_LABEL: Record<ViewMode, string> = { tech: "Tech PIC", sales: "Sales PIC", customer: "Customer", segment: "Cust Segmen" };
const TABLE_COLS: { key: SortKey; label: string }[] = [
  { key: "plant", label: "Plant" },
  { key: "customer", label: "Customer" },
  { key: "order", label: "Order" },
  { key: "batch", label: "Batch" },
  { key: "orderType", label: "Order Type" },
  { key: "sku", label: "SKU / Colour" },
  { key: "qty", label: "Qty L" },
  { key: "tech", label: "Tech PIC" },
  { key: "sales", label: "Sales PIC" },
  { key: "days", label: "Days" },
  { key: "ready", label: "Status" },
];

export default function OpenApprovalWorklist() {
  const { data, isLoading } = useQuery({
    queryKey: ["approval-open-worklist"],
    queryFn: () => api.get<{ success: boolean; data: OpenApprovalRow[] }>("/approvals?onlyOpen=true").then((r) => r.data),
  });

  const items: WorklistItem[] = useMemo(() => {
    const now = Date.now();
    return (data ?? []).map((r) => {
      const start = r.prepareProduksi ? new Date(r.prepareProduksi) : new Date(r.timestamp);
      const days = Math.max(0, Math.floor((now - start.getTime()) / 86400000));
      const qty = Number(String(r.orderQty ?? "").replace(/,/g, "")) || 0;
      return {
        approvalId: r.approvalId,
        order: r.order,
        batch: r.batch?.trim() || "-",
        plant: r.plant?.trim() || "-",
        orderType: r.orderType?.trim() || "-",
        customer: r.customer?.trim() || "UNKNOWN",
        sku: r.materialDescription?.trim() || r.materialNumber?.trim() || "-",
        segment: r.custSegmen?.trim() || "",
        qty,
        tech: r.techName?.trim() || UNASSIGNED,
        sales: r.salesPic?.trim() || UNASSIGNED,
        days,
        bucket: bucketOf(days),
        ready: !!r.submitToCustomer,
      };
    });
  }, [data]);

  const [plant, setPlant] = useState<string>("ALL");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [view, setView] = useState<ViewMode>("tech");
  const [search, setSearch] = useState("");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("ALL");
  const [owner, setOwner] = useState<OwnerFilter>(null);
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [segmentFilter, setSegmentFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "days", dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);

  const plants = useMemo(() => Array.from(new Set(items.map((i) => i.plant))).sort(), [items]);

  const base = useMemo(() => items.filter((i) => plant === "ALL" || i.plant === plant), [items, plant]);

  function resetPlantScopedFilters() {
    setBucket(null);
    setOwner(null);
    setCustomerFilter(null);
    setSegmentFilter(null);
  }

  function clearFilters() {
    setBucket(null);
    setSearch("");
    setReadyFilter("ALL");
    setOwner(null);
    setCustomerFilter(null);
    setSegmentFilter(null);
  }

  const explorerRows = useMemo(() => {
    let rows = base;
    if (bucket) rows = rows.filter((i) => i.bucket === bucket);
    if (readyFilter === "ready") rows = rows.filter((i) => i.ready);
    if (readyFilter === "wip") rows = rows.filter((i) => !i.ready);
    if (readyFilter === "notech") rows = rows.filter((i) => i.tech === UNASSIGNED);
    if (owner) rows = rows.filter((i) => i[owner.role] === owner.name);
    if (customerFilter) rows = rows.filter((i) => i.customer === customerFilter);
    if (segmentFilter) rows = rows.filter((i) => (i.segment || "UNKNOWN") === segmentFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((i) => `${i.customer} ${i.sku} ${i.order} ${i.batch} ${i.tech} ${i.sales}`.toLowerCase().includes(q));
    }
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      if (key === "days" || key === "qty") return ((a[key] as number) - (b[key] as number)) * dir;
      if (key === "ready") return (Number(a.ready) - Number(b.ready)) * dir;
      const x = String(a[key] ?? "").toLowerCase();
      const y = String(b[key] ?? "").toLowerCase();
      return x < y ? -dir : x > y ? dir : 0;
    });
  }, [base, bucket, readyFilter, owner, customerFilter, segmentFilter, search, sort]);

  const groups = useMemo(() => {
    const scoped = bucket ? base.filter((i) => i.bucket === bucket) : base;
    const key = view;
    const map = new Map<string, WorklistItem[]>();
    for (const item of scoped) {
      const name = item[key] || "UNKNOWN";
      const arr = map.get(name) ?? [];
      arr.push(item);
      map.set(name, arr);
    }
    const arr = Array.from(map.entries()).map(([name, its]) => ({
      name,
      items: [...its].sort((a, b) => b.days - a.days),
      n: its.length,
      qty: its.reduce((s, d) => s + d.qty, 0),
      oldest: Math.max(...its.map((d) => d.days)),
      ready: its.filter((d) => d.ready).length,
    }));
    arr.sort((a, b) => {
      const au = a.name === UNASSIGNED;
      const bu = b.name === UNASSIGNED;
      if (au !== bu) return au ? -1 : 1;
      return b.oldest - a.oldest;
    });
    return arr;
  }, [base, bucket, view]);

  function setSortKey(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function onOwnerHeadClick(name: string) {
    if (expanded !== name) {
      setExpanded(name);
      return;
    }
    if (view === "customer") {
      setCustomerFilter(name);
      setOwner(null);
      setSegmentFilter(null);
    } else if (view === "segment") {
      setSegmentFilter(name);
      setOwner(null);
      setCustomerFilter(null);
    } else {
      setOwner({ role: view, name });
      setCustomerFilter(null);
      setSegmentFilter(null);
    }
    document.getElementById("open-approval-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const qtyPending = base.reduce((s, d) => s + d.qty, 0);
  const custCount = new Set(base.map((d) => d.customer)).size;
  const oldest = base.reduce((m, d) => Math.max(m, d.days), 0);
  const noOwnerCount = base.filter((d) => d.sales === UNASSIGNED).length;
  const readyCount = base.filter((d) => d.ready).length;

  const activeFilterBits: string[] = [];
  if (owner) activeFilterBits.push(`${owner.role === "tech" ? "Tech" : "Sales"} = ${owner.name === UNASSIGNED ? "none" : owner.name}`);
  if (customerFilter) activeFilterBits.push(`Customer = ${customerFilter}`);
  if (segmentFilter) activeFilterBits.push(`Cust Segmen = ${segmentFilter}`);
  if (bucket) activeFilterBits.push(`${bucket} days`);
  if (readyFilter !== "ALL") activeFilterBits.push({ ready: "Ready for sign-off", wip: "Not ready", notech: "No Tech PIC" }[readyFilter]);

  if (isLoading) return <div className="panel-body text-sm text-slate-500">Memuat worklist...</div>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Dashboard Approval</h2>
          <p className="mt-0.5 text-xs text-slate-500">Item Approval yang belum Finish App, dikelompokkan per Tech/Sales PIC.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {["ALL", ...plants].map((p) => (
            <button
              key={p}
              onClick={() => {
                setPlant(p);
                resetPlantScopedFilters();
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                plant === p ? "bg-rose-600 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {p === "ALL" ? "Semua" : p}
              <span className="ml-1.5 opacity-70">{p === "ALL" ? items.length : items.filter((i) => i.plant === p).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Open items" value={base.length} sub={plants.map((p) => `${base.filter((i) => i.plant === p).length} ${p}`).join(" · ")} />
        <Kpi label="Qty pending" value={fmt(qtyPending)} sub="liter menunggu approval" />
        <Kpi label="Customers" value={custCount} sub="perlu dikejar sign-off" />
        <Kpi label="Oldest open" value={`${oldest}d`} sub="sejak tanggal mulai" tone="amber" />
        <Kpi label="Ready sign-off" value={readyCount} sub="sudah submit ke customer" tone="teal" />
        <Kpi label="No sales owner" value={noOwnerCount} sub="belum ada yang kejar customer" tone="red" />
      </div>

      {/* Aging buckets */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-700">Aging</h3>
          <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">
            {bucket ? `filter ${bucket} hari — klik lagi untuk hapus` : "klik untuk filter semua bagian di bawah"}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {BUCKETS.map((bk) => {
            const rows = base.filter((i) => i.bucket === bk);
            const on = bucket === bk;
            return (
              <button
                key={bk}
                onClick={() => setBucket(bucket === bk ? null : bk)}
                className={`relative overflow-hidden rounded-lg border bg-white px-2 py-2.5 text-center transition hover:-translate-y-0.5 ${
                  on ? "border-slate-800 ring-1 ring-slate-800" : "border-slate-200"
                }`}
              >
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: BUCKET_COLOR[bk] }} />
                <div className="text-[0.68rem] text-slate-500">{bk} hari</div>
                <div className="mt-1 text-lg font-bold" style={{ color: BUCKET_COLOR[bk] }}>
                  {rows.length}
                </div>
                <div className="mt-0.5 text-[0.62rem] text-slate-400">{fmt(rows.reduce((s, d) => s + d.qty, 0))} L</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Owner cards */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-700">Siapa yang pegang open approval</h3>
          <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">klik kartu untuk expand · klik lagi untuk filter tabel</span>
        </div>
        <div className="mb-3 flex gap-1.5">
          {(Object.keys(VIEW_LABEL) as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                setExpanded(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                view === v ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              By {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3">
          {groups.map((g) => {
            // `alert` cuma bisa "true" di view "tech"/"sales" (customer/segment
            // pakai fallback "UNKNOWN", bukan UNASSIGNED -- lihat `groups`).
            // Label kartu-nya DIPERBAIKI 2026-09-01 (ditemukan lewat laporan
            // user: kartu "⚠ No sales owner" tetap muncul walau lagi di view
            // "By Tech PIC", bikin bingung, PADAHAL kartunya lagi nunjukkin
            // Tech PIC yg kosong bukan Sales PIC) -- SEBELUMNYA teks "No sales
            // owner" di-hardcode apa pun view-nya, sekarang ikut
            // `VIEW_LABEL[view]` supaya sesuai role yg lagi ditampilkan.
            // Dropdown "☰"/Item Explorer di bawah JUGA ikut diganti jadi "No
            // Tech PIC" (filter `readyFilter === "notech"`, bukan lagi cek
            // Sales PIC) krn di data real Sales PIC SELALU terisi (0 kosong),
            // Tech PIC yg justru sering kosong (144 item saat laporan ini).
            const alert = g.name === UNASSIGNED;
            const color = alert ? "#dc2626" : avatarColor(g.name);
            const isOpen = expanded === g.name;
            return (
              <div key={g.name} className={`overflow-hidden rounded-xl border bg-white transition ${alert ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
                <button onClick={() => onOwnerHeadClick(g.name)} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left">
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
                    style={{ background: color }}
                  >
                    {LIST_VIEWS.includes(view) ? (g.name === "UNKNOWN" ? "?" : g.name.slice(0, 2).toUpperCase()) : initials(g.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-bold ${alert ? "text-red-600" : "text-slate-800"}`}>
                      {alert ? `⚠ No ${VIEW_LABEL[view]}` : g.name}
                    </div>
                    <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">
                      {VIEW_LABEL[view]}
                      {alert ? " · assign someone" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-800">{g.n}</div>
                    <div className="text-[0.6rem] uppercase text-slate-400">items</div>
                  </div>
                </button>
                <div className="grid grid-cols-3 border-t border-slate-100 text-center">
                  <div className="border-r border-slate-100 py-2">
                    <div className="text-sm font-bold text-slate-700">{fmt(g.qty)}</div>
                    <div className="text-[0.58rem] uppercase text-slate-400">liter</div>
                  </div>
                  <div className="border-r border-slate-100 py-2">
                    <div className="text-sm font-bold" style={{ color: g.oldest > 60 ? "#dc2626" : g.oldest > 30 ? "#d97706" : "#059669" }}>
                      {g.oldest}d
                    </div>
                    <div className="text-[0.58rem] uppercase text-slate-400">oldest</div>
                  </div>
                  <div className="py-2">
                    <div className="text-sm font-bold text-emerald-600">{g.ready}</div>
                    <div className="text-[0.58rem] uppercase text-slate-400">ready</div>
                  </div>
                </div>
                {isOpen && (
                  <div className="max-h-[280px] overflow-auto border-t border-slate-100 bg-slate-50/60">
                    {g.items.map((d) => (
                      <div key={d.approvalId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[0.72rem] last:border-b-0">
                        <span className="min-w-[34px] font-bold" style={{ color: BUCKET_COLOR[d.bucket] }}>
                          {d.days}d
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate font-semibold text-slate-700">{d.sku}</b>
                          <small className="text-[0.62rem] text-slate-400">
                            {d.customer} · PO {d.order}
                            {view !== "sales" ? ` · ${d.sales === UNASSIGNED ? "no sales owner" : d.sales}` : ""}
                          </small>
                        </span>
                        <span className="whitespace-nowrap text-right text-[0.68rem] text-slate-500">
                          {fmt(d.qty)}L
                          <br />
                          <StatusPill ready={d.ready} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <div className="text-sm text-slate-400">Tidak ada item terbuka.</div>}
        </div>
      </div>

      {/* Item explorer */}
      <div id="open-approval-table">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-700">Item explorer</h3>
          <span className="text-[0.7rem] uppercase tracking-wide text-slate-400">
            {explorerRows.length} dari {base.length} open
          </span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <span>🔎</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="cari customer, SKU, PWO, nama..."
              className="w-full border-none bg-transparent p-0 text-sm shadow-none outline-none focus:ring-0"
            />
          </div>
          <select
            value={readyFilter}
            onChange={(e) => setReadyFilter(e.target.value as ReadyFilter)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="ALL">Semua item</option>
            <option value="ready">Ready sign-off saja</option>
            <option value="wip">Belum ready</option>
            <option value="notech">No Tech PIC</option>
          </select>
          <button onClick={clearFilters} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
            clear filters
          </button>
        </div>
        {activeFilterBits.length > 0 && <div className="mb-2 text-xs text-amber-600">▸ filtering: {activeFilterBits.join(" · ")}</div>}

        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          {explorerRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">Tidak ada item yang cocok dengan filter ini.</div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {TABLE_COLS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => setSortKey(c.key)}
                      className="cursor-pointer whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-[0.68rem] uppercase tracking-wide text-slate-500 hover:text-slate-700"
                    >
                      {c.label} <span className="opacity-40">{sort.key === c.key ? (sort.dir > 0 ? "▲" : "▼") : ""}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {explorerRows.map((d) => (
                  <tr key={d.approvalId} className="border-b border-slate-100 last:border-b-0 hover:bg-rose-50/40">
                    <td className="px-3 py-2 text-xs text-slate-500">{d.plant}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setCustomerFilter(d.customer);
                          setOwner(null);
                          setSegmentFilter(null);
                        }}
                        className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                      >
                        {d.customer}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{d.order}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{d.batch}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{d.orderType}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      <div className="truncate font-semibold text-slate-700">{d.sku}</div>
                      {d.segment && <small className="text-[0.65rem] text-slate-400">{d.segment}</small>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">{fmt(d.qty)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setOwner({ role: "tech", name: d.tech });
                          setCustomerFilter(null);
                          setSegmentFilter(null);
                        }}
                        className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                      >
                        {d.tech}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setOwner({ role: "sales", name: d.sales });
                          setCustomerFilter(null);
                          setSegmentFilter(null);
                        }}
                        className={`rounded px-2 py-0.5 text-xs ${
                          d.sales === UNASSIGNED ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {d.sales === UNASSIGNED ? "none" : d.sales}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-sm font-bold" style={{ color: BUCKET_COLOR[d.bucket] }}>
                      {d.days}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill ready={d.ready} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** Kartu KPI -- pola SAMA PERSIS dgn KpiCard di dashboard lain (Tank/Mesin/
 * Produktivitas Monitoring, lihat komentar sama di sana): `.panel` + border
 * atas 4px warna tone, label abu-abu (var(--text-muted)) di atas, angka besar
 * SELALU var(--navy-dark) (tone cuma mewarnai border, bukan angkanya) --
 * disamakan 2026-09-01 (instruksi eksplisit user, sebelumnya kartu ini pakai
 * gaya Tailwind slate/rose terpisah sendiri, beda dgn dashboard lain). Baris
 * `sub` (keterangan tambahan) tetap dipertahankan, cuma ikut restyle muted.
 */
function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone?: "amber" | "teal" | "red" }) {
  const color = tone === "amber" ? "#d97706" : tone === "teal" ? "var(--success)" : tone === "red" ? "var(--danger)" : "var(--navy-light)";
  return (
    <div className="panel" style={{ padding: 16, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--navy-dark)" }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: "0.68rem", lineHeight: 1.3, color: "var(--text-muted)" }}>{sub}</div>
    </div>
  );
}

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${
        ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {ready ? "ready" : "wip"}
    </span>
  );
}
