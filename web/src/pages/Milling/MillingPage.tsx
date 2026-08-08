import { CSSProperties, Fragment, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import MesinSelect from "../../components/MesinSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import EmployeeNameSelect, {
  formatInputBy,
  isKnownEmployeeName,
  useEmployeeOptions,
  normalizeMembers,
  displayNameWithNik,
  resolveEmployeeId,
  MemberEntry,
} from "../../components/EmployeeNameSelect";
import DataTable from "../../components/DataTable";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/** Lebar kolom label "Pass N" di tabel Fineness/Visco/Suhu -- TIDAK resizable
 * oleh user (tetap konstan), tapi didaftarkan sbg entry biasa di
 * MILLING_COL_DEFAULT_WIDTHS/MILLING_COL_ROWS supaya math leftEdge/snap-guide
 * di lib/useResizableColWidths tetap benar utk kolom Fineness/Visco/Suhu yg
 * ada DI SEBELAH KANANnya. */
const PASS_LABEL_COL_WIDTH = 70;

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). */
const MILLING_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 220,
  materialNumber: 200,
  materialDescription: 260,
  batch: 160,
  orderQty: 140,
  plant: 120,
  iuPlant: 160,
  codeTanki1: 170,
  codeTanki2: 170,
  codeMesin: 150,
  spvProduksi: 170,
  leader: 170,
  qtyAct: 160,
  formReceived: 190,
  start: 190,
  finish: 190,
  member: 180,
  passLabel: PASS_LABEL_COL_WIDTH,
  fineness: 140,
  visco: 140,
  suhu: 140,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah.
 * Layout direvisi 2026-07-26 sesuai mockup eksplisit user (baris Order/Material/
 * Batch/Qty/Plant digabung jadi 1 baris, Form Received/Start/Finish jadi baris
 * tersendiri sebelum SPV/Leader/Qty Act). Baris "passLabel/fineness/visco/suhu"
 * ditambahkan 2026-07-28 supaya tabel Pass (Fineness/Visco/Suhu) di bawahnya
 * ikut kena smart-guide snap-align dgn kolom2 lain di form ini, sesuai
 * permintaan eksplisit user. */
const MILLING_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki1", "codeTanki2", "codeMesin"],
  ["formReceived", "start", "finish"],
  ["spvProduksi", "leader", "qtyAct"],
  ["member"],
  ["passLabel", "fineness", "visco", "suhu"],
];

interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
  codeTanki: string;
  spvProduksi: string;
  leader: string | null;
  members: (string | MemberEntry)[] | null;
  qtyPerMan: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string;
  remark: string | null;
}

interface LogRow {
  id: number;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string;
  codeTanki1: string | null;
  codeTanki2: string | null;
  codeMesin: string | null;
  formReceived: string | null;
  start: string | null;
  finish: string | null;
  spvProduksi: string;
  spvProduksiNik: string | null;
  leader: string | null;
  leaderNik: string | null;
  qtyAct: string | null;
  members: (string | MemberEntry)[] | null;
  fineness: string[] | null;
  visco: string[] | null;
  suhu: string[] | null;
  remark: string | null;
  inputBy: string;
  attachments: { id: number; fileName: string; filePath: string }[];
}

/** 1 baris History = 1 Pass (bukan 1 baris = 1 record Milling) -- "unpivot"
 * supaya tabel History-nya tidy/flat, gampang di-export ke Excel & langsung
 * bisa dibuat PivotTable (tiap kombinasi Order+Pass jadi barisnya sendiri,
 * kolom lain yg sifatnya per-record diulang di tiap barisnya), sesuai
 * permintaan eksplisit user (2026-07-28). Kalau record itu belum ada
 * bacaan Fineness/Visco/Suhu sama sekali, tetap tampil 1 baris (Pass kosong)
 * supaya record-nya tidak hilang dari History. */
interface FlatHistoryRow {
  key: string;
  log: LogRow;
  passLabel: string;
  fineness: string;
  visco: string;
  suhu: string;
}

function flattenHistory(rows: LogRow[]): FlatHistoryRow[] {
  const out: FlatHistoryRow[] = [];
  for (const log of rows) {
    const finenessArr = log.fineness ?? [];
    const viscoArr = log.visco ?? [];
    const suhuArr = log.suhu ?? [];
    const passCount = Math.max(finenessArr.length, viscoArr.length, suhuArr.length);
    if (passCount === 0) {
      out.push({ key: `${log.id}-0`, log, passLabel: "", fineness: "", visco: "", suhu: "" });
      continue;
    }
    for (let i = 0; i < passCount; i++) {
      out.push({
        key: `${log.id}-${i}`,
        log,
        passLabel: `Pass ${i + 1}`,
        fineness: finenessArr[i] ?? "",
        visco: viscoArr[i] ?? "",
        suhu: suhuArr[i] ?? "",
      });
    }
  }
  return out;
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki1: "",
  codeTanki2: "",
  codeMesin: "",
  formReceived: "",
  start: "",
  finish: "",
  spvProduksi: "",
  spvProduksiNik: null as string | null,
  leader: "",
  leaderNik: null as string | null,
  qtyAct: "",
  members: [] as MemberEntry[],
  fineness: [""],
  visco: [""],
  suhu: [""],
  remark: "",
};

const GRID_BORDER = "1px solid #cbd5e1";

/** Tabel "Pass N" (Fineness/Visco/Suhu sejajar per baris), sesuai revisi
 * mockup eksplisit user (2026-07-28) -- menggantikan 3 grid terpisah 10-slot
 * dgn 1 tabel ringkas yg barisnya ("Pass 1", "Pass 2", dst) ditambah/dikurangi
 * lewat tombol +/-. Lebar kolom Fineness/Visco/Suhu bisa di-drag oleh user
 * (persis pola drag-resize ExcelField, lihat lib/useResizableColWidths) --
 * hanya header yg punya resize-handle, tapi lebarnya berlaku ke semua baris
 * Pass di bawahnya. Tombol +/- SENGAJA dibuat kotak kecil ber-ikon saja (bukan
 * tombol lebar "+ Add"/"− Reduce") supaya tidak oversize, sesuai instruksi
 * eksplisit user (2026-07-28) -- mirip tombol group/outline show-hide Excel. */
function PassReadingsTable({
  fineness,
  visco,
  suhu,
  onChange,
  onAdd,
  onRemove,
  colWidths,
  beginResize,
  guideX,
}: {
  fineness: string[];
  visco: string[];
  suhu: string[];
  onChange: (field: "fineness" | "visco" | "suhu", idx: number, value: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  colWidths: Record<string, number>;
  beginResize: (colKey: string) => (e: ReactMouseEvent) => void;
  /** Posisi garis bantu "smart guide" (magnet snap) saat drag -- state yg SAMA
   * dipakai ExcelBlock utama di atas (lihat lib/useResizableColWidths), supaya
   * kolom Fineness/Visco/Suhu ikut nempel/snap ke tepi kolom lain di form ini
   * persis seperti kolom2 lain, sesuai permintaan eksplisit user (2026-07-28). */
  guideX: number | null;
}) {
  const rows = fineness.length;
  const labelW = colWidths.passLabel ?? PASS_LABEL_COL_WIDTH;
  const fW = colWidths.fineness ?? 140;
  const vW = colWidths.visco ?? 140;
  const sW = colWidths.suhu ?? 140;
  const gridTemplateColumns = `${labelW}px ${fW}px ${vW}px ${sW}px`;
  // Posisi X tepi-kanan tiap kolom yg bisa di-resize -- handle drag utk kolom
  // "fineness" diletakkan di tepi kanan kolom Fineness itu sendiri, dst
  // (persis semantik beginResize: geser menambah/mengurangi lebar colKey itu).
  const xFineness = labelW + fW;
  const xVisco = xFineness + vW;
  const xSuhu = xVisco + sW;

  const headerCellStyle: CSSProperties = { textAlign: "center" };
  const dataCellStyle: CSSProperties = { textAlign: "center", border: GRID_BORDER, padding: "6px 4px", width: "100%", boxSizing: "border-box" };
  const passLabelStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--muted)",
  };
  function resizeHandleStyle(x: number): CSSProperties {
    return { position: "absolute", top: 0, bottom: 0, left: x - 3, width: 6, cursor: "col-resize", touchAction: "none" };
  }

  return (
    <div className="excel-block" style={{ marginTop: 8, border: GRID_BORDER }}>
      {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
      {/* Wrapper relative terpisah dari grid supaya handle drag bisa membentang
         FULL TINGGI tabel (header + semua baris Pass), bukan cuma setipis baris
         header -- target drag jadi jauh lebih mudah diklik, sesuai keluhan user
         (2026-07-28) bahwa kolom "belum bisa di-resize" (target lama kekecilan). */}
      <div style={{ position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns }}>
          <div />
          <div className="excel-cell-label" style={headerCellStyle}>Fineness</div>
          <div className="excel-cell-label" style={headerCellStyle}>Visco</div>
          <div className="excel-cell-label" style={headerCellStyle}>Suhu</div>
          {Array.from({ length: rows }).map((_, idx) => (
            <Fragment key={idx}>
              <div style={passLabelStyle}>Pass {idx + 1}</div>
              <input value={fineness[idx] ?? ""} onChange={(e) => onChange("fineness", idx, e.target.value)} style={dataCellStyle} />
              <input value={visco[idx] ?? ""} onChange={(e) => onChange("visco", idx, e.target.value)} style={dataCellStyle} />
              <input value={suhu[idx] ?? ""} onChange={(e) => onChange("suhu", idx, e.target.value)} style={dataCellStyle} />
            </Fragment>
          ))}
        </div>
        <div className="col-resize-handle" onMouseDown={beginResize("fineness")} title="Drag utk ubah lebar kolom Fineness" style={resizeHandleStyle(xFineness)} />
        <div className="col-resize-handle" onMouseDown={beginResize("visco")} title="Drag utk ubah lebar kolom Visco" style={resizeHandleStyle(xVisco)} />
        <div className="col-resize-handle" onMouseDown={beginResize("suhu")} title="Drag utk ubah lebar kolom Suhu" style={resizeHandleStyle(xSuhu)} />
      </div>
      <div style={{ display: "flex", gap: 4, padding: 4 }}>
        <button
          type="button"
          className="btn btn-info"
          title="Tambah Pass"
          aria-label="Tambah Pass"
          style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
          onClick={onAdd}
        >
          +
        </button>
        <button
          type="button"
          className="btn btn-danger"
          title="Kurangi Pass"
          aria-label="Kurangi Pass"
          style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
          onClick={onRemove}
          disabled={rows <= 1}
        >
          −
        </button>
      </div>
    </div>
  );
}

export default function MillingPage({
  embedded = false,
  initialOrder,
  onSaved,
}: {
  /** Mode ringkas dipakai pop-up "Tahap Selanjutnya" di Production Order
   * Monitoring (2026-07-31, instruksi eksplisit user) -- lihat komentar sama
   * di PremixAftermixPage.tsx. */
  embedded?: boolean;
  initialOrder?: string;
  onSaved?: () => void;
} = {}) {
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, "milling") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const { data: tanks } = useTankOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [memberNikInput, setMemberNikInput] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    MILLING_COL_DEFAULT_WIDTHS,
    "millingColWidths",
    MILLING_COL_ROWS
  );

  const historyQuery = useQuery({
    queryKey: ["milling-history"],
    queryFn: () => api.get<{ success: boolean; data: LogRow[] }>("/milling/history").then((r) => r.data),
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input -- lihat komentar sama di PremixAftermixPage.tsx.
    enabled: !embedded,
  });

  const queueQuery = useQuery({
    queryKey: ["milling-pwo-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/milling/pwo-queue").then((r) => r.data),
    enabled: !embedded,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? api.put<{ success: boolean; data: LogRow }>(`/milling/${editingId}`, form)
        : api.post<{ success: boolean; data: LogRow }>("/milling", form),
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingId;
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
      if (attachmentFile) {
        uploadMutation.mutate({ id: res.data.id, file: attachmentFile });
      } else {
        setMessage(wasEditing ? "Data Milling berhasil diperbarui." : "Data Milling berhasil disimpan.");
      }
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/milling/${id}`),
    onSuccess: () => {
      setMessage("Data Milling berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/milling/${id}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachmentFile(null);
      queryClient.invalidateQueries({ queryKey: ["milling-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));
    try {
      const res = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (res.data) {
        setForm((f) => ({ ...f, iuPlant: res.data!.iuPlant || f.iuPlant }));
      }
    } catch {
      /* saran IU Plant bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
    // Code Tanki 2 (Moving) SENGAJA diambil dari Code Tanki proses Premix
    // (bukan dari histori Milling sendiri) -- Code Tanki 1 (Couple) & Code
    // Mesin tetap diisi manual oleh SPV area Milling, sesuai instruksi
    // eksplisit user (2026-07-26).
    try {
      const premixRes = await api.get<{ success: boolean; data: { codeTanki: string } | null }>(
        `/premix-aftermix/latest-by-order/${encodeURIComponent(data.order)}?section=PREMIX`
      );
      if (premixRes.data) {
        setForm((f) => ({ ...f, codeTanki2: premixRes.data!.codeTanki || f.codeTanki2 }));
      }
    } catch {
      /* belum ada data Premix utk Order ini -- biarkan Code Tanki 2 kosong, diisi manual */
    }
    // Kolom lain (SPV Produksi, Leader, Member, Code Tanki 1, Code Mesin,
    // Start, Finish, Fineness/Visco/Suhu, Remark) diambil dari input TERAKHIR
    // (mesin manapun) untuk Order ini di Milling. Asumsi default: user
    // melanjutkan/mengedit mesin yg SAMA dgn histori paling akhir -- kalau
    // user lalu mengganti Code Mesin secara manual, lihat checkMachineRecord
    // di bawah (dipanggil saat blur) yg akan cek ulang apakah itu mesin yg
    // sudah pernah diinput (edit) atau mesin BARU (1 Order running di >1
    // mesin sekaligus -- entri baru, bukan menimpa), sesuai instruksi
    // eksplisit user (2026-07-26).
    try {
      const latestRes = await api.get<{ success: boolean; data: LogRow | null }>(
        `/milling/latest-by-order/${encodeURIComponent(data.order)}`
      );
      const latest = latestRes.data;
      if (latest) {
        setEditingId(latest.id);
        setForm((f) => ({
          ...f,
          spvProduksi: f.spvProduksi || latest.spvProduksi || "",
          spvProduksiNik: f.spvProduksi ? f.spvProduksiNik : latest.spvProduksiNik ?? null,
          leader: f.leader || latest.leader || "",
          leaderNik: f.leader ? f.leaderNik : latest.leaderNik ?? null,
          qtyAct: f.qtyAct || latest.qtyAct || "",
          members: f.members.length > 0 ? f.members : normalizeMembers(latest.members),
          codeTanki1: f.codeTanki1 || latest.codeTanki1 || "",
          codeMesin: f.codeMesin || latest.codeMesin || "",
          formReceived: f.formReceived || latest.formReceived || "",
          start: f.start || latest.start || "",
          finish: f.finish || latest.finish || "",
          fineness: f.fineness.some(Boolean) ? f.fineness : normalizeReadings(latest.fineness),
          visco: f.visco.some(Boolean) ? f.visco : normalizeReadings(latest.visco),
          suhu: f.suhu.some(Boolean) ? f.suhu : normalizeReadings(latest.suhu),
          remark: f.remark || latest.remark || "",
        }));
      } else {
        setEditingId(null);
      }
    } catch {
      /* belum ada input sebelumnya untuk Order ini -- biarkan kosong */
    }
  }

  // Mode pop-up "Tahap Selanjutnya" (embedded+initialOrder) -- lihat komentar
  // sama di PremixAftermixPage.tsx.
  useEffect(() => {
    if (!embedded || !initialOrder) return;
    setForm((f) => ({ ...f, order: initialOrder }));
    api
      .get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder)}`)
      .then((res) => handleOrderFound(res.data))
      .catch(() => {
        /* Order tidak ditemukan di Master Data -- biarkan kosong, user isi manual */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialOrder]);

  /** Dipanggil saat user selesai mengetik/mengganti Code Mesin (blur) -- cek
   * ulang apakah kombinasi Order + Code Mesin ini SUDAH pernah diinput
   * sebelumnya (berarti sedang mengedit record mesin itu) atau BELUM (berarti
   * Order ini sedang running di mesin lain scr bersamaan -- harus jadi entri
   * BARU, bukan menimpa record mesin sebelumnya), sesuai instruksi eksplisit
   * user (2026-07-26). */
  async function checkMachineRecord() {
    const order = form.order.trim();
    const codeMesin = form.codeMesin.trim();
    if (!order || !codeMesin) return;
    try {
      const res = await api.get<{ success: boolean; data: LogRow | null }>(
        `/milling/latest-by-order/${encodeURIComponent(order)}?codeMesin=${encodeURIComponent(codeMesin)}`
      );
      const match = res.data;
      if (match) {
        setEditingId(match.id);
        setForm((f) => ({
          ...f,
          spvProduksi: match.spvProduksi || f.spvProduksi,
          spvProduksiNik: match.spvProduksiNik ?? f.spvProduksiNik,
          leader: match.leader ?? f.leader,
          leaderNik: match.leaderNik ?? f.leaderNik,
          qtyAct: match.qtyAct ?? f.qtyAct,
          members: match.members ? normalizeMembers(match.members) : f.members,
          codeTanki1: match.codeTanki1 ?? f.codeTanki1,
          formReceived: match.formReceived ?? f.formReceived,
          start: match.start ?? f.start,
          finish: match.finish ?? f.finish,
          fineness: match.fineness ? normalizeReadings(match.fineness) : f.fineness,
          visco: match.visco ? normalizeReadings(match.visco) : f.visco,
          suhu: match.suhu ? normalizeReadings(match.suhu) : f.suhu,
          remark: match.remark ?? f.remark,
        }));
      } else {
        // Kombinasi Order + Code Mesin ini belum pernah ada -- entri BARU
        // (POST) begitu Save, BUKAN menimpa record mesin lain utk Order yg sama.
        setEditingId(null);
      }
    } catch {
      /* biarkan state form apa adanya kalau lookup gagal */
    }
  }

  function addMember() {
    const name = memberInput.trim();
    if (!name) return;
    if (!isKnownEmployeeName(employees, name)) {
      setError("Nama Member tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    setError("");
    setForm((f) => ({ ...f, members: [...f.members, { name, nik: memberNikInput }] }));
    setMemberInput("");
    setMemberNikInput(null);
  }

  function removeLastMember() {
    setForm((f) => ({ ...f, members: f.members.slice(0, -1) }));
  }

  function updateReading(field: "fineness" | "visco" | "suhu", idx: number, value: string) {
    setForm((f) => ({ ...f, [field]: f[field].map((v, i) => (i === idx ? value : v)) }));
  }

  /** Bungkus array bacaan dari backend jadi minimal 1 baris "Pass" -- BEDA
   * dari padReadings lama yg selalu memaksa 10 slot; di sini panjang array
   * asli (jumlah Pass yg sudah pernah diisi) dipertahankan apa adanya. */
  function normalizeReadings(values: string[] | null): string[] {
    const arr = values ?? [];
    return arr.length > 0 ? [...arr] : [""];
  }

  function addPass() {
    setForm((f) => ({
      ...f,
      fineness: [...f.fineness, ""],
      visco: [...f.visco, ""],
      suhu: [...f.suhu, ""],
    }));
  }

  function removePass() {
    setForm((f) =>
      f.fineness.length <= 1
        ? f
        : { ...f, fineness: f.fineness.slice(0, -1), visco: f.visco.slice(0, -1), suhu: f.suhu.slice(0, -1) }
    );
  }

  function startEdit(row: LogRow) {
    setEditingId(row.id);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch,
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant,
      codeTanki1: row.codeTanki1 ?? "",
      codeTanki2: row.codeTanki2 ?? "",
      codeMesin: row.codeMesin ?? "",
      formReceived: row.formReceived ?? "",
      start: row.start ?? "",
      finish: row.finish ?? "",
      spvProduksi: row.spvProduksi,
      spvProduksiNik: row.spvProduksiNik ?? null,
      leader: row.leader ?? "",
      leaderNik: row.leaderNik ?? null,
      qtyAct: row.qtyAct ?? "",
      members: normalizeMembers(row.members),
      fineness: normalizeReadings(row.fineness),
      visco: normalizeReadings(row.visco),
      suhu: normalizeReadings(row.suhu),
      remark: row.remark ?? "",
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  /** Isi Order dari PWO Schedule & Queue ke form Input Milling (lewat alur
   * handleOrderFound yg sama dgn ketik manual di OrderLookup), supaya Order
   * qty/Material/Plant/IU Plant/Code Tanki tersaran otomatis begitu tim
   * Milling mengambil PWO ini dari antrian. */
  function loadIntoInput(row: QueueRow) {
    setForm((f) => ({ ...f, order: row.order }));
    handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      // Milling tidak punya kolom Types of Products/Base Color/Volume --
      // 3 field ini cuma dipakai Colour Matching & Packing, jadi null di sini tidak berpengaruh.
      jenis: null,
      warnaDasar: null,
      volume: null,
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownEmployeeName(employees, form.spvProduksi)) {
      setError("SPV Produksi tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.leader)) {
      setError("Leader tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownTankCode(tanks, form.codeTanki1)) {
      setError("Code Tanki 1 (Couple) tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownTankCode(tanks, form.codeTanki2)) {
      setError("Code Tanki 2 (Moving) tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    saveMutation.mutate();
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
  );
  const flatHistory = flattenHistory(filteredHistory);

  const filteredQueue = (queueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
              Input Milling
            </button>
          )}
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
          <button className={`btn ${tab === "queue" ? "" : "btn-outline"}`} onClick={() => setTab("queue")}>
            PWO Schedule &amp; Queue
          </button>
        </div>
      )}

      {(embedded || tab === "input") && (
        <div className="panel">
          <form className="panel-body" onSubmit={handleSubmit}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title="Production & MRP Schedule » Milling, Input Proses">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")}>
                  <OrderLookup bare value={form.order} onChange={(v) => setForm({ ...form, order: v })} onFound={handleOrderFound} />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
                </ExcelField>
                <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")}>
                  <IuPlantSelect bare id="milling-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki 1 (Couple)" widthPx={colWidths.codeTanki1} onResizeStart={beginResize("codeTanki1")}>
                  <TankSelect bare id="milling-tank-1" value={form.codeTanki1} onChange={(v) => setForm({ ...form, codeTanki1: v })} required={false} />
                </ExcelField>
                <ExcelField label="Code Tanki 2 (Moving)" widthPx={colWidths.codeTanki2} onResizeStart={beginResize("codeTanki2")}>
                  <TankSelect bare id="milling-tank-2" value={form.codeTanki2} onChange={(v) => setForm({ ...form, codeTanki2: v })} required={false} />
                </ExcelField>
                <ExcelField label="Code Mesin" widthPx={colWidths.codeMesin} onResizeStart={beginResize("codeMesin")}>
                  <MesinSelect
                    bare
                    id="milling-mesin"
                    value={form.codeMesin}
                    onChange={(v) => setForm({ ...form, codeMesin: v })}
                    onBlur={checkMachineRecord}
                    required={false}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Form Received" widthPx={colWidths.formReceived} onResizeStart={beginResize("formReceived")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.formReceived)}
                    onChange={(e) => setForm({ ...form, formReceived: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Start" widthPx={colWidths.start} onResizeStart={beginResize("start")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.start)}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Finish" widthPx={colWidths.finish} onResizeStart={beginResize("finish")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.finish)}
                    onChange={(e) => setForm({ ...form, finish: e.target.value })}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="SPV Produksi" widthPx={colWidths.spvProduksi} onResizeStart={beginResize("spvProduksi")}>
                  <EmployeeNameSelect
                    bare
                    id="milling-spv"
                    value={form.spvProduksi}
                    employeeId={form.spvProduksiNik}
                    onChange={(v, nik) => setForm({ ...form, spvProduksi: v, spvProduksiNik: nik ?? null })}
                    required
                  />
                </ExcelField>
                <ExcelField label="Leader" widthPx={colWidths.leader} onResizeStart={beginResize("leader")}>
                  <EmployeeNameSelect
                    bare
                    id="milling-leader"
                    value={form.leader}
                    employeeId={form.leaderNik}
                    onChange={(v, nik) => setForm({ ...form, leader: v, leaderNik: nik ?? null })}
                  />
                </ExcelField>
                <ExcelField label="Qty Act" color="orange" widthPx={colWidths.qtyAct} onResizeStart={beginResize("qtyAct")}>
                  <input value={form.qtyAct} onChange={(e) => setForm({ ...form, qtyAct: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="Member" widthPx={colWidths.member} onResizeStart={beginResize("member")}>
                  <EmployeeNameSelect
                    bare
                    id="milling-member"
                    value={memberInput}
                    employeeId={memberNikInput}
                    onChange={(v, nik) => {
                      setMemberInput(v);
                      setMemberNikInput(nik ?? null);
                    }}
                    placeholder="Nama anggota"
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <div className="excel-cell" style={{ flexBasis: "15%", maxWidth: "15%", flexDirection: "row", gap: 4, padding: 4 }}>
                  <button
                    type="button"
                    className="btn btn-info"
                    title="Tambah Member"
                    aria-label="Tambah Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={addMember}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Kurangi Member"
                    aria-label="Kurangi Member"
                    style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
                    onClick={removeLastMember}
                    disabled={form.members.length === 0}
                  >
                    −
                  </button>
                </div>
              </ExcelRow>
              {form.members.length > 0 && (
                <ExcelRow>
                  <div className="excel-member-cell" style={{ flexBasis: "50%", maxWidth: "50%" }}>
                    <div className="excel-member-list">
                      {form.members.map((m, idx) => (
                        <span key={idx} className="excel-member-chip">
                          {m.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </ExcelRow>
              )}
            </ExcelBlock>

            <PassReadingsTable
              fineness={form.fineness}
              visco={form.visco}
              suhu={form.suhu}
              onChange={updateReading}
              onAdd={addPass}
              onRemove={removePass}
              colWidths={colWidths}
              beginResize={beginResize}
              guideX={guideX}
            />

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Remark</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {attachmentFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachmentFile.name}</span>}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingId && (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  Batal Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History Milling</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: FlatHistoryRow) => r.key}
              exportFileName="history-milling"
              storageKey="milling-history"
              rows={flatHistory}
              columns={[
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.log.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.log.timestamp),
                },
                { key: "order", label: "Order", render: (r) => r.log.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.log.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.log.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.log.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.log.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.log.plant },
                { key: "spvProduksi", label: "SPV Produksi", render: (r) => r.log.spvProduksi },
                {
                  key: "spvEmployeeId",
                  label: "SPV Employee ID",
                  render: (r) => resolveEmployeeId(employees, r.log.spvProduksi, r.log.spvProduksiNik),
                },
                { key: "leader", label: "Leader", render: (r) => r.log.leader },
                {
                  key: "leaderEmployeeId",
                  label: "Leader Employee ID",
                  render: (r) => resolveEmployeeId(employees, r.log.leader, r.log.leaderNik),
                },
                { key: "qtyAct", label: "Qty Act", render: (r) => r.log.qtyAct },
                {
                  key: "members",
                  label: "Member",
                  render: (r) => {
                    const members = normalizeMembers(r.log.members);
                    const list = members.map((m) => displayNameWithNik(employees, m.name, m.nik));
                    return [String(members.length), ...list].join(" | ");
                  },
                },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.log.iuPlant },
                { key: "codeMesin", label: "Code Mesin", render: (r) => r.log.codeMesin },
                { key: "codeTanki1", label: "Code Tanki 1 (Couple)", render: (r) => r.log.codeTanki1 },
                { key: "codeTanki2", label: "Code Tanki 2 (Moving)", render: (r) => r.log.codeTanki2 },
                {
                  key: "formReceived",
                  label: "Form Received",
                  render: (r) => (r.log.formReceived ? formatDateTime(r.log.formReceived) : ""),
                  csvValue: (r) => (r.log.formReceived ? toExcelDateTimeString(r.log.formReceived) : ""),
                },
                {
                  key: "start",
                  label: "Start",
                  render: (r) => (r.log.start ? formatDateTime(r.log.start) : ""),
                  csvValue: (r) => (r.log.start ? toExcelDateTimeString(r.log.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish",
                  render: (r) => (r.log.finish ? formatDateTime(r.log.finish) : ""),
                  csvValue: (r) => (r.log.finish ? toExcelDateTimeString(r.log.finish) : ""),
                },
                { key: "pass", label: "Pass", render: (r) => r.passLabel },
                { key: "fineness", label: "Fineness", render: (r) => r.fineness },
                { key: "visco", label: "Visco", render: (r) => r.visco },
                { key: "suhu", label: "Suhu", render: (r) => r.suhu },
                { key: "remark", label: "Remark", render: (r) => r.log.remark },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.log.inputBy) },
                { key: "attachments", label: "Lampiran", render: (r) => (r.log.attachments.length ? `${r.log.attachments.length} file` : "-") },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r.log)}>
                        ✏️
                      </button>
                      {getMenuLevel(user, "milling") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Milling untuk Order ${r.log.order}?`)) deleteMutation.mutate(r.log.id);
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
      )}

      {tab === "queue" && (
        <div className="panel">
          <div className="panel-header">PWO Schedule &amp; Queue</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              PWO yang sudah Finish Premix dan sedang menunggu dikerjakan Milling -- diurutkan Finish Premix paling
              awal duluan (FIFO). PWO otomatis hilang dari daftar ini begitu sudah ada input Milling utk PWO
              tersebut, atau begitu PWO itu sudah masuk tahap setelah Milling (Aftermix, Colour Matching, Approval,
              Packing) -- yg berarti Premix-nya sudah pasti selesai walau input Milling-nya sendiri tidak tercatat.
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="pwo-schedule-queue"
              storageKey="milling-pwo-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki (Premix)", render: (r) => r.codeTanki },
                { key: "spvProduksi", label: "SPV Produksi (Premix)", render: (r) => r.spvProduksi },
                { key: "leader", label: "Leader (Premix)", render: (r) => r.leader },
                {
                  key: "members",
                  label: "Member (Premix)",
                  render: (r) => normalizeMembers(r.members).map((m) => m.name).join(", "),
                },
                { key: "qtyPerMan", label: "Qty/Man (Liter)", render: (r) => r.qtyPerMan },
                {
                  key: "start",
                  label: "Start Premix",
                  render: (r) => (r.start ? formatDateTime(r.start) : ""),
                  csvValue: (r) => (r.start ? toExcelDateTimeString(r.start) : ""),
                },
                {
                  key: "finish",
                  label: "Finish Premix",
                  render: (r) => formatDateTime(r.finish),
                  csvValue: (r) => toExcelDateTimeString(r.finish),
                },
                { key: "remark", label: "Remark (Premix)", render: (r) => r.remark },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <button
                      className="btn btn-outline"
                      type="button"
                      style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                      onClick={() => loadIntoInput(r)}
                    >
                      Input Milling
                    </button>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
