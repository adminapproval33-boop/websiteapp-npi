import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fileUrl } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import CustomerSelect from "../../components/CustomerSelect";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { ExcelBlock, ExcelRow, ExcelField, ExcelSubHeader } from "../../components/ExcelGrid";
import EmployeeNameSelect, {
  displayNameWithNik,
  EmployeeOption,
  formatInputBy,
  isKnownEmployeeName,
  useEmployeeOptions,
  useNameSuggestions,
} from "../../components/EmployeeNameSelect";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString, validateNotFutureDate } from "../../lib/datetime";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { handleExcelGridKeyNav } from "../../lib/excelGridNav";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

interface ApprovalRow {
  approvalId: string;
  timestamp: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  mrpPic: string | null;
  mrpPicNik: string | null;
  salesPic: string | null;
  salesPicNik: string | null;
  prepareProduksi: string | null;
  sprayMan: string | null;
  sprayManNik: string | null;
  wetSample: string | null;
  panel: string | null;
  lotCoa: string | null;
  sendToTech: string | null;
  technicalDateReceiving: string | null;
  submitToCustomer: string | null;
  customer: string | null;
  custSegmen: string | null;
  multipleCust: string | null;
  techName: string | null;
  techNameNik: string | null;
  finishApp: string | null;
  remark: string | null;
  needsImprove: boolean;
  inputBy: string;
}

interface LotHistoryRow extends ApprovalRow {
  /** Diambil live dari MasterOrder ("Referensi Order / PO (SAP-COOISPI)")
   * lewat GET /approvals/lot-history di backend, bukan snapshot -- jadi
   * otomatis ikut berubah kalau Master Data Cooispi di-update ulang. */
  pctGR: string | null;
  status: "Prepare Approval" | "Pending Approval" | "Approval" | "Oke Approval";
  processingTime: string;
  hasAttachment: boolean;
}

/** Baris "List Antrian Approval" -- Order yg Admin QC Stage terbarunya
 * "Approval"/"Joint Lot" dan belum diinput ke Approval (lihat GET
 * /approvals/queue di approval.routes.ts). */
interface QueueRow {
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  codeTanki: string | null;
  typeLot: string | null;
  lotPassed: string | null;
  qcToApproval: string | null;
  qcPassed: string | null;
  remark: string | null;
}

interface Attachment {
  id: number;
  fileName: string;
  filePath: string;
  remark: string | null;
  uploadedBy: string;
  timestamp: string;
}

/** Tombol "Sync ke Google Sheet" DIBATASI cuma utk 5 NIK ini (2026-08-23,
 * instruksi eksplisit user) -- cuma utk sembunyikan tombolnya di sini,
 * validasi yg SESUNGGUHNYA ada di backend (ALLOWED_SYNC_NIKS di
 * approval.routes.ts) krn frontend bisa dilewati lewat panggilan API langsung. */
const ALLOWED_SYNC_NIKS = ["000001", "019375", "001475", "012385", "019701"];

const FILTER_COLUMNS = [
  { value: "order", label: "Order" },
  { value: "materialNumber", label: "Material Number" },
  { value: "materialDescription", label: "Material Description" },
  { value: "batch", label: "Batch" },
  { value: "plant", label: "Plant" },
  { value: "iuPlant", label: "IU Plant" },
  { value: "codeTanki", label: "Code Tanki" },
  { value: "mrpPic", label: "Mrp Pic" },
  { value: "salesPic", label: "Sales Pic" },
  { value: "sprayMan", label: "Spray Man" },
  { value: "customer", label: "Customer" },
  { value: "techName", label: "Tech Name" },
];

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki: "",
  mrpPic: "",
  mrpPicNik: null as string | null,
  salesPic: "",
  salesPicNik: null as string | null,
  prepareProduksi: "",
  sprayMan: "",
  sprayManNik: null as string | null,
  wetSample: "",
  panel: "",
  lotCoa: "",
  sendToTech: "",
  technicalDateReceiving: "",
  submitToCustomer: "",
  customer: "",
  custSegmen: "",
  // Default "-" (2026-09-02, instruksi eksplisit user) -- kasus paling umum
  // memang tidak ada Multiple Cust tambahan, jadi admin tidak perlu ketik "-"
  // manual tiap kali buat entri baru. Field ini WAJIB diisi (lihat validasi
  // required di ExcelField-nya) -- default ini cuma nilai awal, admin tetap
  // bebas ganti (mis. ketik nama customer) kalau memang mau bikin baris
  // Multiple Cust terpisah.
  multipleCust: "-",
  techName: "",
  techNameNik: null as string | null,
  finishApp: "",
  remark: "",
  needsImprove: false,
};

/** Lebar default (px) tiap kolom form Input Proses -- dipakai sbg fallback sebelum
 * user pernah drag-resize (lihat lib/useResizableColWidths). Admin QC Stage/Lot
 * Passed/QC to App/QC Passed DIPINDAH ke menu "Input Admin QC" terpisah
 * (2026-07-28, sesuai instruksi eksplisit user) -- tidak ada lagi di sini. Mrp
 * Pic/Sales Pic sempat ikut pindah tapi DIKEMBALIKAN ke sini (2026-07-29,
 * revisi layout eksplisit user). */
const APPROVAL_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 140,
  materialNumber: 140,
  materialDescription: 220,
  batch: 120,
  orderQty: 110,
  plant: 100,
  iuPlant: 150,
  codeTankiRow2: 150,
  mrpPic: 150,
  salesPic: 150,
  prepareDate: 170,
  sprayMan: 140,
  wetSample: 130,
  panel: 120,
  lotCoa: 170,
  sendToTech: 170,
  submitTech: 170,
  submitCust: 170,
  customer: 160,
  custSegmen: 150,
  multipleCust: 150,
  techName: 160,
  finishApp: 170,
};

/** Urutan kolom per baris visual (utk snap-to-align saat drag-resize -- lihat
 * lib/useResizableColWidths). Harus cocok dgn urutan ExcelField di JSX di bawah. */
const APPROVAL_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTankiRow2", "mrpPic", "salesPic"],
  ["prepareDate", "sprayMan", "wetSample", "panel", "multipleCust", "lotCoa", "sendToTech"],
  ["submitTech", "submitCust", "customer", "custSegmen", "techName", "finishApp"],
];

const APPROVAL_PANEL_BORDER = "1px solid #cbd5e1";

/** String non-kosong (setelah trim) ATAU Date manapun dianggap "terisi" --
 * versi client-side dari `isFilled` di approval.routes.ts (server). */
function isFieldFilled(v: string | null): boolean {
  return v !== null && v.trim().length > 0;
}

/** Verdict status per baris (2026-09-02, instruksi eksplisit user: 4 tingkat
 * berdasar sekumpulan kolom yg sudah terisi) -- versi client-side dari
 * `computeStatus` di approval.routes.ts (server), dipakai KHUSUS utk badge di
 * panel `MultipleCustPanel` di bawah (murni tampilan, keputusan resmi status
 * tetap dihitung server spt biasa di GET /lot-history). Lihat komentar
 * lengkap di `computeStatus` (server) utk penjelasan tiap tingkat. */
function approvalStatusBadge(row: ApprovalRow): "Prepare Approval" | "Pending Approval" | "Approval" | "Oke Approval" {
  const tier1 = [row.prepareProduksi, row.sprayMan, row.wetSample, row.panel, row.multipleCust, row.lotCoa, row.sendToTech].every(
    isFieldFilled
  );
  if (!tier1) return "Prepare Approval";

  const tier2 = [row.technicalDateReceiving, row.submitToCustomer, row.customer, row.custSegmen, row.techName].every(isFieldFilled);
  if (!tier2) return "Pending Approval";

  return isFieldFilled(row.finishApp) ? "Oke Approval" : "Approval";
}

/** Warna badge per status (2026-09-02) -- dipakai di panel `MultipleCustPanel`
 * di bawah. */
const APPROVAL_STATUS_COLOR: Record<string, { background: string; color: string }> = {
  "Prepare Approval": { background: "#f1f5f9", color: "#475569" },
  "Pending Approval": { background: "#dbeafe", color: "#1e40af" },
  Approval: { background: "#fef3c7", color: "#92400e" },
  "Oke Approval": { background: "#dcfce7", color: "#166534" },
};

/** Panel "Multiple Cust" (2026-09-02, instruksi eksplisit user: tampilkan
 * berapa baris Multiple Cust yg sudah pernah diinput utk Order yg lagi ada di
 * form, gaya tampilan PERSIS sama dgn panel "Tanki Turunan" di Milling --
 * lihat TankBranchPanel di MillingPage.tsx -- tapi informasinya menyesuaikan
 * konteks Approval (Customer/Cust Segmen/Tech Name/status), bukan
 * Tanki/Mesin/Qty Act). "Baris N" dihitung dari URUTAN ARRAY (backend GET
 * /approvals/by-order sudah ASC by timestamp), sama pola dgn "Tanki N". */
function MultipleCustPanel({
  order,
  rows,
  editingId,
  onEdit,
  onAddNew,
  onDelete,
  canDelete,
  onView,
}: {
  order: string;
  rows: ApprovalRow[];
  editingId: string | null;
  onEdit: (row: ApprovalRow) => void;
  onAddNew: () => void;
  onDelete: (row: ApprovalRow) => void;
  canDelete: boolean;
  onView: (row: ApprovalRow) => void;
}) {
  return (
    <div className="excel-block" style={{ marginBottom: 14, border: APPROVAL_PANEL_BORDER }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "6px 10px",
          background: "#f1f5f9",
          borderBottom: APPROVAL_PANEL_BORDER,
        }}
      >
        <div>
          <strong>Multiple Cust — Order {order}</strong>
          <span style={{ marginLeft: 10, fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {rows.length} baris sudah diinput
          </span>
        </div>
        <button type="button" className="btn btn-success" style={{ padding: "4px 12px", fontSize: "0.8rem" }} onClick={onAddNew}>
          + Baris Baru
        </button>
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r, idx) => {
          const status = approvalStatusBadge(r);
          const isEditing = editingId === r.approvalId;
          return (
            <div
              key={r.approvalId}
              onClick={() => onView(r)}
              title="Klik untuk lihat detail lengkap baris ini (read-only)"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 12,
                padding: "6px 8px",
                border: isEditing ? "1px solid var(--navy)" : APPROVAL_PANEL_BORDER,
                borderRadius: 4,
                background: isEditing ? "#fff1f2" : "transparent",
                fontSize: "0.85rem",
                flexWrap: "wrap",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 600, minWidth: 70 }}>Baris {idx + 1}</span>
              {r.needsImprove && <span title="Perlu Improve dari Produksi">🔴</span>}
              <span style={{ color: "var(--text-muted)" }}>Multiple Cust: {r.multipleCust || "-"}</span>
              <span style={{ color: "var(--text-muted)" }}>Customer: {r.customer || "-"}</span>
              <span style={{ color: "var(--text-muted)" }}>Cust Segmen: {r.custSegmen || "-"}</span>
              <span style={{ color: "var(--text-muted)" }}>Tech Name: {r.techName || "-"}</span>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: "0.75rem",
                  ...APPROVAL_STATUS_COLOR[status],
                }}
              >
                {status}
              </span>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(r);
                  }}
                >
                  ✏️ Edit
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(r);
                    }}
                  >
                    🗑️ Hapus
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 1 baris label:value di modal detail read-only (`MultipleCustViewDetail` di
 * bawah) -- sama komponen kecil dgn `ViewField` di MillingPage.tsx (tidak
 * diimpor lintas file krn keduanya `function` lokal tak diekspor, cukup
 * disalin -- isinya generik & sangat pendek). */
function ApprovalViewField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.85rem" }}>
      <span style={{ minWidth: 150, flexShrink: 0, fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
      <span>{value ?? "-"}</span>
    </div>
  );
}

/** Isi modal detail read-only 1 baris Approval (2026-09-02) -- dibuka dgn
 * klik baris di `MultipleCustPanel`, sama pola dgn `TankViewDetail` di
 * MillingPage.tsx (klik utk lihat, tombol Edit terpisah utk muat ke form). */
function MultipleCustViewDetail({ row, employees }: { row: ApprovalRow; employees: EmployeeOption[] | undefined }) {
  return (
    <div>
      <ApprovalViewField label="Order" value={row.order} />
      <ApprovalViewField label="Material Number" value={row.materialNumber} />
      <ApprovalViewField label="Batch" value={row.batch} />
      <ApprovalViewField label="Order Qty" value={row.orderQty} />
      <ApprovalViewField label="Plant" value={row.plant} />
      <ApprovalViewField label="IU Plant" value={row.iuPlant} />
      <ApprovalViewField label="Code Tanki" value={row.codeTanki} />
      <ApprovalViewField label="Customer" value={row.customer} />
      <ApprovalViewField label="Cust Segmen" value={row.custSegmen} />
      <ApprovalViewField label="Multiple Cust" value={row.multipleCust} />
      <ApprovalViewField label="Mrp Pic" value={displayNameWithNik(employees, row.mrpPic, row.mrpPicNik)} />
      <ApprovalViewField label="Sales Pic" value={displayNameWithNik(employees, row.salesPic, row.salesPicNik)} />
      <ApprovalViewField label="Spray Man" value={displayNameWithNik(employees, row.sprayMan, row.sprayManNik)} />
      <ApprovalViewField label="Tech Name" value={displayNameWithNik(employees, row.techName, row.techNameNik)} />
      <ApprovalViewField label="Prepare Produksi" value={formatDateTime(row.prepareProduksi)} />
      <ApprovalViewField label="Wet Sample" value={row.wetSample} />
      <ApprovalViewField label="Panel" value={row.panel} />
      <ApprovalViewField label="Lot COA" value={formatDateTime(row.lotCoa)} />
      <ApprovalViewField label="Send To Tech" value={formatDateTime(row.sendToTech)} />
      <ApprovalViewField label="Submit Tech" value={formatDateTime(row.technicalDateReceiving)} />
      <ApprovalViewField label="Submit Cust" value={formatDateTime(row.submitToCustomer)} />
      <ApprovalViewField label="Finish App" value={formatDateTime(row.finishApp)} />
      <ApprovalViewField label="Remark" value={row.remark} />
      <ApprovalViewField label="Improve" value={row.needsImprove ? "🔴 Perlu Improve dari Produksi" : "-"} />
      <ApprovalViewField label="Input By" value={formatInputBy(employees, row.inputBy)} />
      <ApprovalViewField label="Timestamp" value={formatDateTime(row.timestamp)} />
    </div>
  );
}

export default function ApprovalPage({
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
  const isViewOnly = getMenuLevel(user, "approval") === "VIEW";
  const { data: employees } = useEmployeeOptions();
  const { data: sprayManSuggestions } = useNameSuggestions("approval", "sprayMan");
  const { data: mrpPicSuggestions } = useNameSuggestions("approval", "mrpPic");
  const { data: salesPicSuggestions } = useNameSuggestions("approval", "salesPic");
  const { data: techNameSuggestions } = useNameSuggestions("approval", "techName");
  const { data: tanks } = useTankOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history" | "queue">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** Order yang ternyata SUDAH punya baris Approval (2026-09-02, instruksi
   * eksplisit user: banyak Order kedobelan di Lot History krn orang ke-2
   * (biasanya tim Teknikal) ketik ulang Order yg sama di tab Input alih-alih
   * klik Edit ✏️ di baris yg sudah ada -- Save baru (POST) selalu bikin baris
   * TERPISAH, bukan menimpa). Diisi di `handleOrderFound` begitu
   * `/approvals/latest-by-order` nemu baris existing DAN kita TIDAK lagi
   * sedang mode Edit -- dipakai buat nampilin banner peringatan + tombol
   * pintas "Edit Baris yang Sudah Ada" supaya admin sadar & tidak bikin
   * duplikat baru tanpa sengaja. TIDAK memblokir Save total (Multiple Cust
   * yg sengaja nambah baris utk Order yg sama tetap harus tetap bisa). */
  const [duplicateOrderWarning, setDuplicateOrderWarning] = useState<ApprovalRow | null>(null);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [queueSearch, setQueueSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { widths: colWidths, beginResize, guideX, reset: resetColWidths } = useResizableColWidths(
    APPROVAL_COL_DEFAULT_WIDTHS,
    "approvalInputColWidths",
    APPROVAL_COL_ROWS
  );
  /** Navigasi panah ala Excel antar ExcelField -- lihat lib/excelGridNav.ts. */
  const gridNav = (key: string) => ({ navKey: key, onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleExcelGridKeyNav(e, APPROVAL_COL_ROWS) });

  const [statusFilter, setStatusFilter] = useState("");
  const [filterCol, setFilterCol] = useState("order");
  const [filterValue, setFilterValue] = useState("");
  const [attachmentModalId, setAttachmentModalId] = useState<string | null>(null);
  const [viewingApproval, setViewingApproval] = useState<ApprovalRow | null>(null);
  /** Lagi fetch fresh riwayat Trial/Improve utk hitung nomor berikutnya
   * (2026-09-02) -- lihat komentar panjang di tombol "Improve". Dipakai
   * cuma utk `disabled` tombol itu sendiri, cegah double-klik nyelip di
   * antara fetch & setForm. */
  const [improveTrialLoading, setImproveTrialLoading] = useState(false);
  /** Order yg lagi ada di `form.order` SUDAH TERKONFIRMASI ketemu di
   * "Referensi Order / PO (SAP-COOISPI)" (2026-09-02, instruksi eksplisit
   * user: tombol Save/Simpan Perubahan HARUS mati kalau Order tidak
   * ditemukan -- termasuk kalau tadinya ketemu tapi teksnya diedit LAGI
   * setelah itu, mis. ditambah karakter, TANPA sempat di-cari ulang &
   * ketemu). `false` = default (form baru/order belum di-cek atau baru
   * diketik ulang), jadi tombol Save mati sampai salah satu dari ini
   * terjadi: (a) lookup Order berhasil (`handleOrderFound` -- dipanggil baik
   * dari `onFound` OrderLookup maupun dari `loadIntoInput` Queue), atau (b)
   * masuk mode Edit lewat baris yg SUDAH TERSIMPAN (`startEdit` -- order-nya
   * otomatis dianggap valid, tidak perlu di-lookup ulang). Diset `false` lagi
   * tiap kali teks Order berubah (`onChange` OrderLookup) atau lookup GAGAL
   * (`onNotFound`), supaya admin WAJIB nunggu hasil pencarian TERBARU
   * sebelum bisa Save -- tidak bisa "menang cepat" ketik-lalu-ubah-lagi
   * sebelum lookup sempat jalan. */
  const [orderConfirmed, setOrderConfirmed] = useState(false);

  /** Semua baris Approval yg sudah pernah diinput utk Order yg lagi ada di
   * form ini -- dasar panel "Multiple Cust" (2026-09-02, instruksi eksplisit
   * user: tampilan sama pola dgn panel "Tanki Turunan" di Milling, lihat
   * `MultipleCustPanel` di atas). Diurutkan ASC dari backend (GET
   * /approvals/by-order), jadi index array = nomor "Baris N". */
  const orderForMultiCust = form.order.trim();
  const multiCustQuery = useQuery({
    queryKey: ["approval-by-order", orderForMultiCust],
    queryFn: () => api.get<{ success: boolean; data: ApprovalRow[] }>(`/approvals/by-order/${encodeURIComponent(orderForMultiCust)}`).then((r) => r.data),
    enabled: orderForMultiCust.length > 0,
  });
  const existingApprovalsForOrder = multiCustQuery.data ?? [];

  /** Tanggal HARI INI, format "dd/mm/yy" (2026-09-02, dipakai oleh
   * appendNextImproveTrial & appendImproveResolved di bawah) -- tanggal LOKAL
   * device (bukan UTC), supaya cocok dgn jam yg ditampilkan di pojok kanan
   * atas aplikasi. */
  function todayDDMMYY(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }

  /** Tambahkan 1 baris baru ke Remark yg SUDAH ADA TANPA menimpa isi lama
   * (2026-09-02, instruksi eksplisit user: riwayat Trial/Improve harus tetap
   * kelihatan semua, bukan tertimpa tiap klik). */
  function appendRemarkLine(currentRemark: string, line: string): string {
    const trimmed = currentRemark.trim();
    return trimmed ? `${trimmed}\n${line}` : line;
  }

  /** Nomor Trial TERTINGGI yg sudah pernah tercatat utk Order ini -- dibaca
   * dari Remark SAAT INI (`currentRemark`, termasuk baris2 lama yg mungkin
   * belum ke-refetch dari server) DIGABUNG dgn Remark semua baris riwayat
   * Order ini yg DIOPER lewat `historyRows` (2026-09-02 fix: SEMPAT baca
   * langsung dari `existingApprovalsForOrder`/cache React Query, ternyata
   * itu race condition -- kalau masuk mode Edit dari tombol Edit di tabel
   * "Lot History" [BUKAN dari panel "Multiple Cust" di tab Input, yg baru
   * tampil KALAU datanya sudah lebih dulu ke-load], query
   * `/approvals/by-order` belum tentu selesai fetch ulang saat admin
   * langsung klik "Improve" abis itu -- `existingApprovalsForOrder` sempat
   * kosong/basi sesaat, nomor Trial jadi salah hitung ulang dari 1. Sekarang
   * pemanggil (tombol Improve) WAJIB fetch fresh dulu & oper hasilnya ke
   * sini lewat parameter, tidak baca closure lagi) -- pakai `matchAll`
   * (bukan `match`) krn satu Remark sekarang bisa punya BANYAK baris "Trial N
   * (NG)" sekaligus, bukan cuma satu. Baris yg lagi di-Edit TIDAK dikecualikan
   * -- aman krn baik `historyRows` maupun `currentRemark` lokal sama2 dibaca,
   * tidak ada yg ketinggalan. Dipakai bareng oleh appendNextImproveTrial (utk
   * nomor Trial BERIKUTNYA) & appendImproveResolved (utk nomor Trial yg lagi
   * DISELESAIKAN). */
  function latestImproveTrialNumber(currentRemark: string, historyRows: ApprovalRow[]): number {
    const pattern = /Trial (\d+) \(NG\)/gi;
    let maxTrial = 0;
    for (const row of historyRows) {
      for (const match of (row.remark ?? "").matchAll(pattern)) {
        maxTrial = Math.max(maxTrial, parseInt(match[1], 10));
      }
    }
    for (const match of currentRemark.matchAll(pattern)) {
      maxTrial = Math.max(maxTrial, parseInt(match[1], 10));
    }
    return maxTrial;
  }

  /** Nyalakan Tombol Improve -> Remark kena tambah "Trial N (NG) dd/mm/yy"
   * (2026-09-02, instruksi eksplisit user, tanggal klik ikut dicatat; kalau
   * nanti sudah di-improve tapi Approval ulang masih NG, klik lagi -> baris
   * baru "Trial N+1 (NG) dd/mm/yy", dst -- riwayat SEBELUMNYA tidak
   * hilang/tertimpa, lihat appendRemarkLine). `historyRows` HARUS hasil fetch
   * fresh dari pemanggil (lihat komentar latestImproveTrialNumber). */
  function appendNextImproveTrial(currentRemark: string, historyRows: ApprovalRow[]): string {
    const nextTrial = latestImproveTrialNumber(currentRemark, historyRows) + 1;
    return appendRemarkLine(currentRemark, `Trial ${nextTrial} (NG) ${todayDDMMYY()}`);
  }

  /** Matikan Tombol Improve (2026-09-02, instruksi eksplisit user) -> Remark
   * kena tambah "Improve N dd/mm/yy" -- N SAMA PERSIS dgn nomor "Trial N (NG)"
   * TERAKHIR yg tercatat (menandakan Trial itu yg baru selesai di-improve),
   * BUKAN counter terpisah. Hasil akhirnya riwayat berpasangan turun ke bawah:
   * "Trial 1 (NG) .." lalu "Improve 1 .." (begitu dimatikan lagi), lalu kalau
   * masih NG & dinyalakan lagi "Trial 2 (NG) .." dst. `Math.max(1, ...)` cuma
   * jaring pengaman kalau entah kenapa dimatikan tanpa Trial tercatat dulu
   * (seharusnya tidak pernah terjadi lewat alur tombol normal). `historyRows`
   * HARUS hasil fetch fresh dari pemanggil (lihat komentar
   * latestImproveTrialNumber). */
  function appendImproveResolved(currentRemark: string, historyRows: ApprovalRow[]): string {
    const trialNumber = Math.max(1, latestImproveTrialNumber(currentRemark, historyRows));
    return appendRemarkLine(currentRemark, `Improve ${trialNumber} ${todayDDMMYY()}`);
  }

  /** Spray Man (2026-08-12, instruksi eksplisit user): Plant "1201" -> field
   * bebas teks (bukan dropdown Data Karyawan), Plant lain (mis. "1101") ->
   * tetap dropdown wajib spt sebelumnya. Dipakai bareng oleh JSX form &
   * handleSubmit di bawah. */
  const sprayManFreeText = form.plant.trim() === "1201";

  /** Saran Spray Man dari Member TERAKHIR Colour Matching Order ini (ambil
   * anggota pertama -- Spray Man cuma 1 nama, sedangkan Member Colour
   * Matching bisa banyak). Dipakai utk Plant selain "1201" (2026-08-12
   * instruksi eksplisit user), HANYA kalau Spray Man masih kosong -- tetap
   * bisa diganti manual krn ini murni saran, bukan kunci. Fungsi bersama
   * dipakai baik saat Order baru di-lookup MAUPUN saat kolom Plant diedit
   * manual belakangan (2026-08-20, instruksi eksplisit user: saran harus
   * muncul begitu Plant "teridentifikasi" 1101, bukan cuma dari alur lookup). */
  /** Saran Wet Sample/Panel/Customer/Cust Segmen/Mrp Pic/Sales Pic dari baris
   * History Approval TERAKHIR dgn Material Number yg SAMA -- bukan dikunci ke
   * Order yg sama (2026-08-20, instruksi eksplisit user, Mrp Pic/Sales Pic
   * disamakan belakangan) krn field2 ini melekat ke produk (Material Number),
   * yg SERING dipesan ulang lintas Order berbeda-beda, beda dgn Order yg
   * jarang terulang persis. HANYA mengisi field yg masih kosong (termasuk yg
   * mungkin sudah keisi dari histori Order yg sama di `handleOrderFound` --
   * itu didahulukan krn dipanggil lebih dulu), tetap bisa diganti manual krn
   * ini murni saran. Dipakai baik saat Order baru di-lookup MAUPUN saat
   * kolom Material Number diedit manual belakangan (lihat onBlur di JSX-nya).
   */
  /** Saran Customer/Cust Segmen dari baris Check Results TERAKHIR dgn
   * Material Number yg SAMA (2026-08-27, instruksi eksplisit user: sambungkan
   * kolom Customer/Cust Segmen di Approval supaya ikut apa yg diinput di
   * menu Check Results) -- dipanggil SEBELUM suggestFromMaterialHistory di
   * bawah supaya Check Results jadi sumber utama, histori Approval sendiri
   * cuma jadi cadangan kalau Material ini belum pernah ada di Check Results.
   * HANYA mengisi field yg masih kosong, tetap bisa diganti manual krn ini
   * murni saran. Reuse endpoint yg sama dgn suggestCustomerFromMaterialHistory
   * di CheckResultsPage.tsx (`/check-results/latest-by-material`). */
  async function suggestCustomerFromCheckResults(materialNumber: string) {
    try {
      const res = await api.get<{ success: boolean; data: { customer: string | null; custSegmen: string | null } | null }>(
        `/check-results/latest-by-material/${encodeURIComponent(materialNumber)}`
      );
      const latest = res.data;
      if (!latest) return;
      setForm((f) => ({
        ...f,
        customer: f.customer || latest.customer || "",
        custSegmen: f.custSegmen || latest.custSegmen || "",
      }));
    } catch {
      /* saran dari Check Results bersifat opsional -- kalau gagal (mis. tidak
       * ada akses menu Check Results), biarkan fallback ke histori Approval sendiri. */
    }
  }

  async function suggestFromMaterialHistory(materialNumber: string) {
    try {
      const res = await api.get<{ success: boolean; data: ApprovalRow | null }>(
        `/approvals/latest-by-material/${encodeURIComponent(materialNumber)}`
      );
      const latest = res.data;
      if (!latest) return;
      setForm((f) => ({
        ...f,
        wetSample: f.wetSample || latest.wetSample || "",
        panel: f.panel || latest.panel || "",
        customer: f.customer || latest.customer || "",
        custSegmen: f.custSegmen || latest.custSegmen || "",
        // Mrp Pic/Sales Pic (2026-08-20, instruksi eksplisit user: samakan dgn
        // Wet Sample/Panel/Customer/Cust Segmen) -- ikut disarankan dari histori
        // Material Number yg sama, tetap HANYA kalau masih kosong.
        mrpPic: f.mrpPic || latest.mrpPic || "",
        mrpPicNik: f.mrpPic ? f.mrpPicNik : latest.mrpPicNik ?? null,
        salesPic: f.salesPic || latest.salesPic || "",
        salesPicNik: f.salesPic ? f.salesPicNik : latest.salesPicNik ?? null,
      }));
    } catch {
      /* saran dari histori Material Number bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
  }

  async function suggestSprayManFromColourMatching(order: string) {
    try {
      const cm = await api.get<{ success: boolean; data: { members: { name: string; nik?: string | null }[] | null } | null }>(
        `/colour-matching/latest-by-order/${encodeURIComponent(order)}`
      );
      const firstMember = cm.data?.members?.[0];
      if (firstMember?.name) {
        setForm((f) => (f.sprayMan.trim() ? f : { ...f, sprayMan: firstMember.name, sprayManNik: firstMember.nik ?? null }));
      }
    } catch {
      /* saran Spray Man dari Member Colour Matching bersifat opsional -- kalau gagal, biarkan user isi manual */
    }
  }

  const historyQuery = useQuery({
    queryKey: ["approval-lot-history", statusFilter, filterCol, filterValue],
    queryFn: () => {
      const qs = new URLSearchParams({ status: statusFilter, filterCol, filterValue }).toString();
      return api.get<{ success: boolean; data: LotHistoryRow[] }>(`/approvals/lot-history?${qs}`).then((r) => r.data);
    },
    // Mode "embedded" (pop-up "Tahap Selanjutnya", 2026-07-31) cuma
    // nampilin form Input -- lihat komentar sama di PremixAftermixPage.tsx.
    enabled: !embedded,
  });

  const attachmentsQuery = useQuery({
    queryKey: ["approval-attachments", attachmentModalId],
    queryFn: () => api.get<{ success: boolean; data: Attachment[] }>(`/approvals/${attachmentModalId}/attachments`).then((r) => r.data),
    enabled: !!attachmentModalId,
  });

  const queueQuery = useQuery({
    queryKey: ["approval-queue"],
    queryFn: () => api.get<{ success: boolean; data: QueueRow[] }>("/approvals/queue").then((r) => r.data),
    enabled: !embedded,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingApprovalId) {
        const res = await api.put<{ success: boolean; data: ApprovalRow }>(`/approvals/${editingApprovalId}`, form);
        return [res.data];
      }
      // Multiple Cust (2026-09-01, instruksi eksplisit user, mirip "tanki
      // turunan" Milling tapi free-text bukan pilih dari daftar tetap):
      // textarea ini kalau diisi LEBIH DARI 1 baris (1 customer per baris),
      // tiap baris jadi 1 baris Approval TERPISAH di Lot History untuk Order
      // yg SAMA -- field lain (termasuk Order Qty) disalin IDENTIK ke semua
      // baris hasil pecahan, TIDAK dibagi (keputusan eksplisit user). HANYA
      // berlaku utk Save baris BARU -- Edit baris yg sudah ada TETAP 1 baris
      // spt biasa (tidak ikut pecah lagi), diputuskan eksplisit oleh user.
      // Diisi 1 baris/kosong -> tetap 1 baris spt sebelum fitur ini ada.
      const custLines = form.multipleCust
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      // Order ini ternyata SUDAH punya baris Approval (lihat `duplicateOrderWarning`,
      // diisi di `handleOrderFound`) -- otomatis REPLACE baris yg sudah ada (PUT)
      // KALAU Multiple Cust yg baru diketik "tidak ada perubahan" drpd baris yg
      // ketemu itu (2026-09-02, instruksi eksplisit user: dulu Save baru selalu
      // POST -> nambah baris kedua, ternyata bikin Lot History kedobelan tiap kali
      // org lain melanjutkan isian Order yg sama lewat tab Input, bukan tombol
      // Edit). "Tidak ada perubahan" = PERSIS sama dgn Multiple Cust baris yg
      // ketemu -- EXACT MATCH, TIDAK ADA LAGI fallback "kosong dianggap sama
      // dgn apa pun" (2026-09-02, revisi instruksi eksplisit user: Multiple
      // Cust sekarang WAJIB diisi min. "-", lihat `required` di textarea-nya --
      // kalau field WAJIB tapi kebetulan kosong berarti benar2 lupa diisi,
      // bukan sinyal "lanjutan/replace" yg aman diasumsikan).
      //
      // Kalau beda (mis. admin sengaja ketik nama customer BARU 1 baris, lalu
      // Save, ulangi lagi dgn customer lain, dst -- pola pakai Multiple Cust
      // satu-satu per Save, BUKAN sekaligus multi-baris) -- itu maksudnya
      // NAMBAH baris split baru, BUKAN nerusin isian yg sama -- WAJIB tetap
      // POST baris baru (2026-09-02 fix: sempat ke-treat sbg "lanjutan" & malah
      // NIMPA baris sebelumnya, ketauan dari kasus Order 1090016000 yg diinput
      // 3x Multiple Cust beda tapi cuma nyisa 1 baris).
      const existingCustLine = (duplicateOrderWarning?.multipleCust ?? "").trim();
      const newCustLine = custLines[0] ?? "";
      const isSameEntryContinuation = custLines.length <= 1 && newCustLine !== "" && newCustLine === existingCustLine;
      if (duplicateOrderWarning && isSameEntryContinuation) {
        const res = await api.put<{ success: boolean; data: ApprovalRow }>(`/approvals/${duplicateOrderWarning.approvalId}`, form);
        return [res.data];
      }
      const payloads = custLines.length > 1 ? custLines.map((line) => ({ ...form, multipleCust: line })) : [form];
      const created: ApprovalRow[] = [];
      for (const payload of payloads) {
        const res = await api.post<{ success: boolean; data: ApprovalRow }>("/approvals", payload);
        created.push(res.data);
      }
      return created;
    },
    onSuccess: (created) => {
      setError("");
      // Sama persis kondisinya dgn cek di `mutationFn` di atas -- `form`/
      // `duplicateOrderWarning`/`editingApprovalId` belum berubah antara klik
      // Save & callback ini jalan, jadi aman dihitung ulang di sini utk
      // nentuin pesan sukses yg tepat (baris di-UPDATE vs baris BARU).
      const custLines = form.multipleCust
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const existingCustLine = (duplicateOrderWarning?.multipleCust ?? "").trim();
      const newCustLine = custLines[0] ?? "";
      const isSameEntryContinuation = custLines.length <= 1 && newCustLine !== "" && newCustLine === existingCustLine;
      const wasEditing = !!editingApprovalId || (!!duplicateOrderWarning && isSameEntryContinuation);
      setForm(emptyForm);
      setEditingApprovalId(null);
      setDuplicateOrderWarning(null);
      setOrderConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
      queryClient.invalidateQueries({ queryKey: ["approval-queue"] });
      queryClient.invalidateQueries({ queryKey: ["approval-by-order"] });
      if (attachFile) {
        // Lampiran diupload ke SEMUA baris hasil pecahan Multiple Cust
        // (2026-09-01) -- sama prinsipnya dgn Order Qty di atas: lampiran itu
        // konteks bersama Order ini, bukan spesifik 1 customer. Kalau tidak
        // ada pecahan (1 baris biasa/Edit), `created` cuma 1 elemen -- perilaku
        // sama persis spt sebelum fitur ini ada.
        Promise.all(created.map((row) => uploadMutation.mutateAsync({ approvalId: row.approvalId, file: attachFile }))).catch(() => {
          /* pesan error kegagalan upload sudah ditangani onError uploadMutation sendiri */
        });
      } else {
        setMessage(
          wasEditing
            ? "Data Approval berhasil diperbarui."
            : created.length > 1
            ? `Data Approval berhasil disimpan sbg ${created.length} baris terpisah (Multiple Cust).`
            : "Data Approval berhasil disimpan."
        );
      }
      onSaved?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ approvalId, file }: { approvalId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/approvals/${approvalId}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachFile(null);
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  const deleteMutation = useMutation({
    mutationFn: (approvalId: string) => api.delete(`/approvals/${approvalId}`),
    onSuccess: (_res, deletedId) => {
      setMessage("Data Approval berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
      queryClient.invalidateQueries({ queryKey: ["approval-by-order"] });
      // Kalau baris yg dihapus itu yg SEDANG diedit di form (2026-09-02, tombol
      // Hapus di panel Multiple Cust) -- keluar dari mode Edit, drpd form
      // nyangkut nunjuk ke baris yg sudah tidak ada lagi.
      setEditingApprovalId((current) => (current === deletedId ? null : current));
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: ({ approvalId, id }: { approvalId: string; id: number }) => api.delete(`/approvals/${approvalId}/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-attachments"] });
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
    },
  });

  /** Tombol "Sync ke Google Sheet" di tab Lot History (2026-08-23, instruksi
   * eksplisit user) -- kirim filter yg SEDANG AKTIF di tabel (status/filterCol/
   * filterValue) supaya sheet-nya OVERWRITE TOTAL dgn data yg PERSIS SAMA dgn
   * yg lagi ditampilkan, bukan seluruh data tanpa filter. */
  const syncSheetMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>("/approvals/lot-history/sync-to-sheet", { filterCol, filterValue, status: statusFilter }),
    onSuccess: (res) => {
      setError("");
      setMessage(res.message);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal sync ke Google Sheet."),
  });

  async function handleOrderFound(data: OrderRefData) {
    // Dipanggil HANYA di jalur sukses (OrderLookup.onFound & loadIntoInput
    // Queue) -- Order-nya TERKONFIRMASI ketemu, lepas blokir tombol
    // Save/Simpan Perubahan (2026-09-02, lihat deklarasi `orderConfirmed`).
    setOrderConfirmed(true);
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));
    try {
      const res = await api.get<{ success: boolean; data: ApprovalRow | null }>(`/approvals/latest-by-order/${encodeURIComponent(data.order)}`);
      // Order ini sudah punya baris Approval -- kalau kita SEDANG TIDAK mode
      // Edit, tandai supaya banner peringatan muncul (lihat komentar di
      // deklarasi state `duplicateOrderWarning`). Mode Edit tidak perlu
      // ditandai krn Save-nya PUT ke baris yg sama, bukan bikin baris baru.
      setDuplicateOrderWarning(res.data && !editingApprovalId ? res.data : null);
      if (res.data) {
        const latest = res.data;
        setForm((f) => ({
          ...f,
          // Multiple Cust WAJIB diisi (2026-09-02) -- kalau tidak ikut
          // disarankan dari histori spt field lain di sini, admin yg re-entry
          // Order lama (mis. cuma mau update Improve/Remark) kena stuck: Save
          // ditolak diam-diam oleh validasi "wajib diisi" krn field ini
          // kosong (bug nyata, ditemukan 2026-09-02 lewat kasus Order
          // 2190019664 -- Save kelihatan tidak ngefek sama sekali, ternyata
          // browser menahan submit tanpa pesan yg kelihatan). PRIORITAS
          // DIBALIK drpd field lain di sini (`latest` didahulukan, bukan
          // `f`) -- `emptyForm.multipleCust` sekarang default "-" (2026-09-02,
          // instruksi eksplisit user), yg SELALU truthy, jadi pola biasa
          // `f.field || latest.field || ""` tidak akan pernah sampai baca
          // `latest` sama sekali (form dikira "sudah keisi" padahal cuma
          // default kosongan) -- histori Order yg SEBENARNYA (mis. sudah
          // pernah diisi nama customer lain sbg baris split) jadi ketiban
          // "-" tanpa sengaja, bisa bikin deteksi "lanjutan vs baris baru" di
          // saveMutation salah. Kalau admin memang mau bikin baris Multiple
          // Cust BARU, dia tinggal GANTI nilainya manual stlh prefill ini --
          // itu otomatis kepicu jalur "baris baru" di saveMutation (beda dari
          // nilai lama = bukan lanjutan).
          multipleCust: latest.multipleCust || f.multipleCust || "-",
          customer: f.customer || latest.customer || "",
          techName: f.techName || latest.techName || "",
          techNameNik: f.techName ? f.techNameNik : latest.techNameNik ?? null,
          panel: f.panel || latest.panel || "",
          wetSample: f.wetSample || latest.wetSample || "",
          iuPlant: f.iuPlant || latest.iuPlant || "",
          codeTanki: f.codeTanki || latest.codeTanki || "",
          mrpPic: f.mrpPic || latest.mrpPic || "",
          mrpPicNik: f.mrpPic ? f.mrpPicNik : latest.mrpPicNik ?? null,
          salesPic: f.salesPic || latest.salesPic || "",
          salesPicNik: f.salesPic ? f.salesPicNik : latest.salesPicNik ?? null,
          remark: f.remark || latest.remark || "",
          prepareProduksi: f.prepareProduksi || latest.prepareProduksi || "",
          sprayMan: f.sprayMan || latest.sprayMan || "",
          sprayManNik: f.sprayMan ? f.sprayManNik : latest.sprayManNik ?? null,
          lotCoa: f.lotCoa || latest.lotCoa || "",
          sendToTech: f.sendToTech || latest.sendToTech || "",
          technicalDateReceiving: f.technicalDateReceiving || latest.technicalDateReceiving || "",
          submitToCustomer: f.submitToCustomer || latest.submitToCustomer || "",
          finishApp: f.finishApp || latest.finishApp || "",
          custSegmen: f.custSegmen || latest.custSegmen || "",
        }));
      }
    } catch {
      /* tidak ada histori Approval sebelumnya untuk Order ini -- biarkan kosong */
      setDuplicateOrderWarning(null);
    }
    if ((data.materialNumber ?? "").trim()) {
      await suggestCustomerFromCheckResults(data.materialNumber!.trim());
      await suggestFromMaterialHistory(data.materialNumber!.trim());
    }
    try {
      const ctx = await api.get<{ success: boolean; data: { iuPlant: string; codeTanki: string } | null }>(
        `/master-data/order-context/${encodeURIComponent(data.order)}`
      );
      if (ctx.data) {
        setForm((f) => ({
          ...f,
          iuPlant: f.iuPlant || ctx.data!.iuPlant || "",
          codeTanki: f.codeTanki || ctx.data!.codeTanki || "",
        }));
      }
    } catch {
      /* saran IU Plant/Code Tanki bersifat opsional -- Remark SENGAJA tidak ikut disarankan
         dari order-context lintas modul -- kalau gagal, biarkan user isi manual */
    }

    // Spray Man (2026-08-12, instruksi eksplisit user): Plant "1201" ->
    // default "-" kalau masih kosong (field bebas teks, lihat sprayManFreeText).
    // Plant lain (mis. "1101", field dropdown wajib) -> disarankan dari Member
    // TERAKHIR Colour Matching Order ini (ambil anggota pertama -- Spray Man
    // cuma 1 nama, sedangkan Member Colour Matching bisa banyak), tetap bisa
    // diganti manual krn cuma dipakai kalau sprayMan masih kosong.
    if ((data.plant ?? "").trim() === "1201") {
      setForm((f) => (f.sprayMan.trim() ? f : { ...f, sprayMan: "-", sprayManNik: null }));
    } else {
      await suggestSprayManFromColourMatching(data.order);
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

  /** Isi Order dari List Antrian Approval ke form Input Approval (lewat alur
   * handleOrderFound yg sama dgn ketik manual di OrderLookup), supaya
   * Material/Batch/Qty/Plant/IU Plant/Code Tanki tersaran otomatis begitu
   * tim Approval mengambil Order ini dari antrian. */
  async function loadIntoInput(row: QueueRow) {
    setForm((f) => ({ ...f, order: row.order }));
    await handleOrderFound({
      order: row.order,
      batch: row.batch,
      materialNumber: row.materialNumber,
      materialDescription: row.materialDescription,
      orderQty: row.orderQty,
      plant: row.plant,
      jenis: null,
      warnaDasar: null,
      volume: null,
    });
    // IU Plant/Code Tanki dari Admin QC Order ini lebih akurat drpd saran
    // order-context umum di handleOrderFound -- pakai sbg fallback terakhir
    // kalau belum kesisi dari sumber lain.
    setForm((f) => ({
      ...f,
      iuPlant: f.iuPlant || row.iuPlant || "",
      codeTanki: f.codeTanki || row.codeTanki || "",
    }));
    setTab("input");
    setMessage("");
    setError("");
  }

  function startEdit(row: ApprovalRow) {
    setEditingApprovalId(row.approvalId);
    setDuplicateOrderWarning(null);
    // Order baris ini SUDAH TERSIMPAN (pasti pernah valid) -- tidak perlu
    // di-lookup ulang, lepas blokir tombol Save/Simpan Perubahan langsung
    // (2026-09-02, lihat deklarasi `orderConfirmed`).
    setOrderConfirmed(true);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      codeTanki: row.codeTanki ?? "",
      mrpPic: row.mrpPic ?? "",
      mrpPicNik: row.mrpPicNik ?? null,
      salesPic: row.salesPic ?? "",
      salesPicNik: row.salesPicNik ?? null,
      prepareProduksi: row.prepareProduksi ?? "",
      sprayMan: row.sprayMan ?? "",
      sprayManNik: row.sprayManNik ?? null,
      wetSample: row.wetSample ?? "",
      panel: row.panel ?? "",
      lotCoa: row.lotCoa ?? "",
      sendToTech: row.sendToTech ?? "",
      technicalDateReceiving: row.technicalDateReceiving ?? "",
      submitToCustomer: row.submitToCustomer ?? "",
      customer: row.customer ?? "",
      custSegmen: row.custSegmen ?? "",
      multipleCust: row.multipleCust ?? "",
      techName: row.techName ?? "",
      techNameNik: row.techNameNik ?? null,
      finishApp: row.finishApp ?? "",
      remark: row.remark ?? "",
      needsImprove: row.needsImprove,
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingApprovalId(null);
    setDuplicateOrderWarning(null);
    setOrderConfirmed(false);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  /** Tombol "+ Baris Baru" di panel "Multiple Cust" (2026-09-02) -- BEDA dari
   * "+ Tanki Baru" Milling yg reset field spesifik-fisik: di sini field lain
   * SENGAJA dipertahankan semua (Order/Material/dst SAMPAI Customer/Cust
   * Segmen/Tech Name) krn Multiple Cust memang didesain "field lain disalin
   * IDENTIK ke semua baris hasil pecahan" (lihat komentar di saveMutation) --
   * cuma Multiple Cust sendiri yg dikosongkan (supaya admin ketik nama
   * customer baru) & keluar dari mode Edit/auto-replace, supaya Save
   * berikutnya PASTI bikin baris baru (bukan menimpa baris yg lagi dilihat).
   */
  function startNewMultiCustRow() {
    setEditingApprovalId(null);
    setDuplicateOrderWarning(null);
    setForm((f) => ({ ...f, multipleCust: "" }));
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    // Order ini SUDAH ADA di History (2026-09-02, instruksi eksplisit user) --
    // WAJIB klik "Edit" (di panel Multiple Cust / tabel Lot History) atau "+
    // Baris Baru" dulu sebelum bisa Save, TIDAK BOLEH langsung Save dari
    // hasil ketik Order fresh. `duplicateOrderWarning` cuma kesetel kalau
    // order-nya ketemu histori DAN kita SEDANG TIDAK di mode Edit (lihat
    // handleOrderFound) -- klik Edit ATAU "+ Baris Baru" (lihat startEdit/
    // startNewMultiCustRow) sama2 mengosongkan state ini, jadi begitu salah
    // satu diklik, blokir ini otomatis lepas.
    if (duplicateOrderWarning) {
      setError('Order ini sudah ada di History -- klik "Edit" pada baris yang sesuai, atau "+ Baris Baru" kalau memang mau menambah baris terpisah, sebelum bisa Save.');
      return;
    }
    // Order belum terkonfirmasi ketemu di Referensi Order / PO (SAP-COOISPI)
    // (2026-09-02, instruksi eksplisit user) -- jaring pengaman server-side
    // drpd tombol `disabled` di JSX doang (yg bisa saja ke-bypass, mis. Enter
    // di keyboard tetap men-submit form HTML walau tombolnya sendiri mati).
    if (!orderConfirmed) {
      setError("Order belum terkonfirmasi ketemu di Referensi Order / PO (SAP-COOISPI) -- ketik nomor Order lalu tekan Enter dulu.");
      return;
    }
    if (!form.multipleCust.trim()) {
      setError('Multiple Cust wajib diisi -- ketik "-" kalau memang tidak ada Multiple Cust lain untuk Order ini.');
      return;
    }
    if (!isKnownEmployeeName(employees, form.mrpPic)) {
      setError("Mrp Pic tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.salesPic)) {
      setError("Sales Pic tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    if (!isKnownEmployeeName(employees, form.techName)) {
      setError("Tech Name tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
      return;
    }
    // Spray Man (2026-08-12, instruksi eksplisit user): Plant 1201 -> bebas,
    // tidak divalidasi. Plant selain 1201 (mis. 1101) -> wajib diisi DAN
    // wajib nama yg dikenal Data Karyawan, sama pola dgn Mrp Pic/Sales
    // Pic/Tech Name di atas.
    if (!sprayManFreeText) {
      if (!form.sprayMan.trim()) {
        setError("Spray Man wajib diisi (pilih dari dropdown Data Karyawan) untuk Plant selain 1201.");
        return;
      }
      if (!isKnownEmployeeName(employees, form.sprayMan)) {
        setError("Spray Man tidak ditemukan di Data Karyawan. Pilih dari daftar saran.");
        return;
      }
    }
    if (!isKnownTankCode(tanks, form.codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    // Lot COA/Send To Tech/Submit Tech/Submit Cust SENGAJA TIDAK divalidasi
    // (2026-08-21, instruksi eksplisit user: kolom2 itu boleh tanggal masa
    // depan) -- cuma Prepare Date & Finish App yg tetap diblokir.
    const dateError = validateNotFutureDate(form.prepareProduksi, "Prepare Date") ?? validateNotFutureDate(form.finishApp, "Finish App");
    if (dateError) {
      setError(dateError);
      return;
    }
    saveMutation.mutate();
  }

  const filteredQueue = (queueQuery.data ?? []).filter((row) =>
    queueSearch.trim() ? row.order.toLowerCase().includes(queueSearch.trim().toLowerCase()) : true
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          {!isViewOnly && (
            <button
              className={`btn ${tab === "input" ? "" : "btn-outline"}`}
              onClick={() => {
                setTab("input");
                setMessage("");
                setError("");
              }}
            >
              Input Approval
            </button>
          )}
          <button
            className={`btn ${tab === "history" ? "" : "btn-outline"}`}
            onClick={() => {
              setTab("history");
              setMessage("");
              setError("");
            }}
          >
            Lot History
          </button>
          <button
            className={`btn ${tab === "queue" ? "" : "btn-outline"}`}
            onClick={() => {
              setTab("queue");
              setMessage("");
              setError("");
            }}
          >
            List Antrian Approval
          </button>
        </div>
      )}

      {(embedded || tab === "input") && (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-body">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            {orderForMultiCust.length > 0 && existingApprovalsForOrder.length > 0 && (
              <MultipleCustPanel
                order={orderForMultiCust}
                rows={existingApprovalsForOrder}
                editingId={editingApprovalId}
                onEdit={startEdit}
                onAddNew={startNewMultiCustRow}
                canDelete={getMenuLevel(user, "approval") === "INPUT"}
                onDelete={(row) => {
                  if (confirm(`Hapus data Approval untuk Order ${row.order} (Multiple Cust: ${row.multipleCust || "-"})?`)) {
                    deleteMutation.mutate(row.approvalId);
                  }
                }}
                onView={setViewingApproval}
              />
            )}
            {duplicateOrderWarning && !editingApprovalId && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid var(--danger)",
                  borderRadius: 6,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: "0.85rem",
                  color: "#991b1b",
                }}
              >
                {/* SEKARANG BLOKIR TOTAL, bukan cuma info (2026-09-02, instruksi
                    eksplisit user: Order yg sudah ada di History WAJIB lewat
                    tombol "Edit" atau "+ Baris Baru" -- tidak boleh lagi
                    langsung ketik Order lalu Save dari tab Input polos).
                    Tombol pintas "Edit Baris yang Sudah Ada"/"Buat Baris Baru"
                    di banner ini SENGAJA TIDAK ditampilkan lagi (instruksi
                    eksplisit user sebelumnya) -- admin diarahkan pakai tombol
                    Edit/"+ Baris Baru" di panel "Multiple Cust" di atas
                    (satu2nya jalan lepas dari blokir ini). */}
                ⛔ Order <strong>{duplicateOrderWarning.order}</strong> sudah ada di History (diinput oleh{" "}
                {formatInputBy(employees, duplicateOrderWarning.inputBy)} pada {formatDateTime(duplicateOrderWarning.timestamp)}). Save{" "}
                <strong>tidak bisa diklik</strong> dari sini -- klik <strong>✏️ Edit</strong> pada baris yang sesuai, atau{" "}
                <strong>"+ Baris Baru"</strong> kalau memang mau menambah baris terpisah, di panel "Multiple Cust" di atas.
              </div>
            )}
            <ExcelBlock title="Production & MRP Schedule » Approval, Input Proses">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={colWidths.order} onResizeStart={beginResize("order")} {...gridNav("order")}>
                  <OrderLookup
                    bare
                    value={form.order}
                    onChange={(v) => {
                      setForm({ ...form, order: v });
                      setDuplicateOrderWarning(null);
                      // Teks Order berubah (blm tentu sudah di-cari ulang) --
                      // tombol Save WAJIB mati lagi sampai ada hasil pencarian
                      // TERBARU (2026-09-02, instruksi eksplisit user: ketik
                      // Order valid -> Enter -> balik lagi tambah karakter
                      // TANPA sempat re-search juga harus tetap mati, bukan
                      // cuma pas lookup gagal). Lihat deklarasi
                      // `orderConfirmed`.
                      setOrderConfirmed(false);
                    }}
                    onFound={handleOrderFound}
                    onNotFound={() => {
                      // Order yg diketik SEKARANG tidak ketemu -- reset SEMUA
                      // field turunan Order (2026-09-02, instruksi eksplisit
                      // user). Percobaan pertama (panggil `handleOrderFound`
                      // dgn OrderRefData isi null semua) TERNYATA kurang --
                      // itu cuma bersihkan blok pertama (Material
                      // Number/Description/Batch/Order Qty/Plant), sedangkan
                      // blok KEDUA (IU Plant/Code Tanki/Mrp Pic/Sales
                      // Pic/Panel/Wet Sample/Lot COA/Send To Tech/Submit
                      // Tech/Submit Cust/Customer/Cust Segmen/Tech Name/Finish
                      // App -- semua yg disarankan dari
                      // /approvals/latest-by-order) TIDAK PERNAH ke-reset krn
                      // blok itu cuma NGUBAH field kalau fetch-nya BERHASIL
                      // nemu histori, dibiarkan apa adanya kalau fetch gagal.
                      // Ketauan dari live-test: Plant ke-reset ("") tapi Spray
                      // Man TIDAK (msh "-" lama) -> Spray Man dianggap wajib
                      // dropdown Data Karyawan lagi (krn Plant bukan "1201")
                      // & langsung error validasi, padahal sebelumnya aman.
                      // Reset TOTAL ke emptyForm skrg (kecuali Order/Multiple
                      // Cust/Remark/needsImprove -- 3 itu bisa jadi isian
                      // admin sendiri yg TIDAK berasal dari lookup Order,
                      // sayang kalau ikut hilang cuma krn typo di kolom
                      // Order) menghindari kombinasi "separuh lama separuh
                      // baru" spt ini sama sekali.
                      setForm((f) => ({ ...emptyForm, order: f.order, multipleCust: f.multipleCust, remark: f.remark, needsImprove: f.needsImprove }));
                      setDuplicateOrderWarning(null);
                      setOrderConfirmed(false);
                    }}
                  />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={colWidths.materialNumber} onResizeStart={beginResize("materialNumber")} {...gridNav("materialNumber")}>
                  <input
                    value={form.materialNumber}
                    onChange={(e) => setForm({ ...form, materialNumber: e.target.value })}
                    onBlur={() => {
                      // Saran Wet Sample/Panel/Customer/Cust Segmen dari histori Material
                      // Number ini juga harus tetap muncul begitu kolomnya DIKOREKSI
                      // MANUAL belakangan, bukan cuma saat Order baru di-lookup (2026-08-20,
                      // instruksi eksplisit user). onBlur (bukan tiap ketikan) supaya tidak
                      // fetch berkali-kali selagi masih mengetik. Customer/Cust Segmen
                      // dicoba dulu dari Check Results (2026-08-27, instruksi eksplisit user),
                      // baru fallback ke histori Approval sendiri.
                      const materialNumber = form.materialNumber.trim();
                      if (materialNumber) {
                        suggestCustomerFromCheckResults(materialNumber).then(() => suggestFromMaterialHistory(materialNumber));
                      }
                    }}
                    required
                  />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={colWidths.materialDescription} onResizeStart={beginResize("materialDescription")} {...gridNav("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} />
                </ExcelField>
                <ExcelField label="Batch" widthPx={colWidths.batch} onResizeStart={beginResize("batch")} {...gridNav("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={colWidths.orderQty} onResizeStart={beginResize("orderQty")} {...gridNav("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} />
                </ExcelField>
                <ExcelField label="Plant" widthPx={colWidths.plant} onResizeStart={beginResize("plant")} {...gridNav("plant")}>
                  <input
                    value={form.plant}
                    onChange={(e) => {
                      const plant = e.target.value;
                      setForm((f) => ({
                        ...f,
                        plant,
                        // Plant 1201 (2026-08-12, instruksi eksplisit user): Spray Man
                        // jadi bebas teks, default "-" kalau masih kosong.
                        sprayMan: plant.trim() === "1201" && !f.sprayMan.trim() ? "-" : f.sprayMan,
                      }));
                    }}
                    onBlur={() => {
                      // Plant selain 1201 (mis. "1101", 2026-08-20 instruksi eksplisit
                      // user) -- saran Spray Man dari Colour Matching harus tetap
                      // muncul begitu Plant DIKOREKSI MANUAL belakangan, bukan cuma
                      // saat Order baru pertama kali di-lookup. onBlur (bukan tiap
                      // ketikan) supaya tidak fetch berkali-kali selagi masih mengetik.
                      const plant = form.plant.trim();
                      const order = form.order.trim();
                      if (plant && plant !== "1201" && order && !form.sprayMan.trim()) {
                        suggestSprayManFromColourMatching(order);
                      }
                    }}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={colWidths.iuPlant} onResizeStart={beginResize("iuPlant")} {...gridNav("iuPlant")}>
                  <IuPlantSelect bare id="approval-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={colWidths.codeTankiRow2} onResizeStart={beginResize("codeTankiRow2")} {...gridNav("codeTankiRow2")}>
                  <TankSelect bare id="approval-tank-1" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} required={false} />
                </ExcelField>
                <ExcelField label="Mrp Pic" widthPx={colWidths.mrpPic} onResizeStart={beginResize("mrpPic")} {...gridNav("mrpPic")}>
                  <EmployeeNameSelect
                    bare
                    id="approval-mrp-pic"
                    value={form.mrpPic}
                    employeeId={form.mrpPicNik}
                    onChange={(v, nik) => setForm({ ...form, mrpPic: v, mrpPicNik: nik ?? null })}
                    suggestions={mrpPicSuggestions}
                  />
                </ExcelField>
                <ExcelField label="Sales Pic" widthPx={colWidths.salesPic} onResizeStart={beginResize("salesPic")} {...gridNav("salesPic")}>
                  <EmployeeNameSelect
                    bare
                    id="approval-sales-pic"
                    value={form.salesPic}
                    employeeId={form.salesPicNik}
                    onChange={(v, nik) => setForm({ ...form, salesPic: v, salesPicNik: nik ?? null })}
                    suggestions={salesPicSuggestions}
                  />
                </ExcelField>
              </ExcelRow>
              <ExcelSubHeader label="Production Input Column" color="production" />
              <ExcelRow>
                <ExcelField label="Prepare Date" widthPx={colWidths.prepareDate} onResizeStart={beginResize("prepareDate")} {...gridNav("prepareDate")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.prepareProduksi)} onChange={(e) => setForm({ ...form, prepareProduksi: e.target.value })} />
                </ExcelField>
                <ExcelField label="Spray Man" widthPx={colWidths.sprayMan} onResizeStart={beginResize("sprayMan")} {...gridNav("sprayMan")}>
                  {sprayManFreeText ? (
                    <input
                      value={form.sprayMan}
                      onChange={(e) => setForm({ ...form, sprayMan: e.target.value, sprayManNik: null })}
                      placeholder="-"
                      title="Plant 1201 -- bebas diisi apa saja, tidak wajib dari Data Karyawan."
                    />
                  ) : (
                    <EmployeeNameSelect
                      bare
                      id="approval-spray-man"
                      value={form.sprayMan}
                      employeeId={form.sprayManNik}
                      onChange={(v, nik) => setForm({ ...form, sprayMan: v, sprayManNik: nik ?? null })}
                      suggestions={sprayManSuggestions}
                    />
                  )}
                </ExcelField>
                <ExcelField label="Wet Sample" widthPx={colWidths.wetSample} onResizeStart={beginResize("wetSample")} {...gridNav("wetSample")}>
                  <input value={form.wetSample} onChange={(e) => setForm({ ...form, wetSample: e.target.value })} />
                </ExcelField>
                <ExcelField label="Panel" widthPx={colWidths.panel} onResizeStart={beginResize("panel")} {...gridNav("panel")}>
                  <input value={form.panel} onChange={(e) => setForm({ ...form, panel: e.target.value })} />
                </ExcelField>
                <ExcelField label="Multiple Cust *" widthPx={colWidths.multipleCust} onResizeStart={beginResize("multipleCust")} {...gridNav("multipleCust")}>
                  {/* Textarea, 1 customer per baris (2026-09-01, instruksi
                      eksplisit user, mirip "tanki turunan" Milling tapi
                      free-text bukan pilih dari daftar tetap) -- kalau diisi
                      LEBIH DARI 1 baris SAAT SAVE BARIS BARU (bukan Edit),
                      tiap baris otomatis jadi 1 baris Approval TERPISAH di
                      Lot History, field lain disalin identik (lihat
                      saveMutation). Dipindah ke baris "Production Input
                      Column" sebelah "Panel" (2026-09-02, instruksi eksplisit
                      user).
                      WAJIB diisi (2026-09-02, instruksi eksplisit user) --
                      dulu boleh kosong, ternyata itu bikin auto-replace (lihat
                      saveMutation) ambigu: kalau baris sebelumnya SUDAH py
                      Multiple Cust terisi tapi admin lupa isi ulang saat re-
                      entry, sistem tidak bisa bedakan "sengaja mau
                      kosongkan"/"lupa ketik" dari "memang tidak ada Multiple
                      Cust" -- bisa menimpa nilai lama dgn kosong secara tidak
                      sengaja. Sekarang WAJIB ketik sesuatu, minimal "-" kalau
                      memang tidak ada Multiple Cust lain -- perbandingan
                      "lanjutan/replace vs baris baru" di saveMutation jadi
                      exact-match, tidak ada lagi kasus "kosong dianggap sama
                      dgn apa pun". */}
                  <textarea
                    rows={2}
                    value={form.multipleCust}
                    onChange={(e) => setForm({ ...form, multipleCust: e.target.value })}
                    placeholder='Wajib diisi -- ketik "-" kalau tidak ada Multiple Cust lain, atau 1 customer per baris kalau lebih dari 1'
                    title='Wajib diisi. Ketik "-" kalau tidak ada Multiple Cust lain utk Order ini. Isi lebih dari 1 baris (1 customer per baris) utk otomatis membuat baris Approval terpisah per customer di Lot History saat Save.'
                    required
                  />
                </ExcelField>
                <ExcelField label="Lot COA" widthPx={colWidths.lotCoa} onResizeStart={beginResize("lotCoa")} {...gridNav("lotCoa")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.lotCoa)}
                    onChange={(e) => setForm({ ...form, lotCoa: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Send To Tech" widthPx={colWidths.sendToTech} onResizeStart={beginResize("sendToTech")} {...gridNav("sendToTech")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.sendToTech)} onChange={(e) => setForm({ ...form, sendToTech: e.target.value })} />
                </ExcelField>
              </ExcelRow>
              <ExcelSubHeader label="Technical Input Column" color="technical" />
              <ExcelRow>
                <ExcelField label="Submit Tech" widthPx={colWidths.submitTech} onResizeStart={beginResize("submitTech")} {...gridNav("submitTech")}>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(form.technicalDateReceiving)}
                    onChange={(e) => setForm({ ...form, technicalDateReceiving: e.target.value })}
                  />
                </ExcelField>
                <ExcelField label="Submit Cust" widthPx={colWidths.submitCust} onResizeStart={beginResize("submitCust")} {...gridNav("submitCust")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.submitToCustomer)} onChange={(e) => setForm({ ...form, submitToCustomer: e.target.value })} />
                </ExcelField>
                <ExcelField label="Customer" widthPx={colWidths.customer} onResizeStart={beginResize("customer")} {...gridNav("customer")}>
                  <CustomerSelect bare id="appr-customer" value={form.customer} onChange={(v) => setForm({ ...form, customer: v })} />
                </ExcelField>
                <ExcelField label="Cust Segmen" widthPx={colWidths.custSegmen} onResizeStart={beginResize("custSegmen")} {...gridNav("custSegmen")}>
                  <select value={form.custSegmen} onChange={(e) => setForm({ ...form, custSegmen: e.target.value })}>
                    <option value="">-</option>
                    <option value="AUTOMOTIVE">AUTOMOTIVE</option>
                    <option value="MOTORCYCLE">MOTORCYCLE</option>
                    <option value="GIU">GIU</option>
                    <option value="CCL">CCL</option>
                    <option value="SEMI HALB">SEMI HALB</option>
                    <option value="HARDENER">HARDENER</option>
                  </select>
                </ExcelField>
                <ExcelField label="Tech Name" widthPx={colWidths.techName} onResizeStart={beginResize("techName")} {...gridNav("techName")}>
                  <EmployeeNameSelect
                    bare
                    id="approval-tech-name"
                    value={form.techName}
                    employeeId={form.techNameNik}
                    onChange={(v, nik) => setForm({ ...form, techName: v, techNameNik: nik ?? null })}
                    suggestions={techNameSuggestions}
                  />
                </ExcelField>
                <ExcelField label="Finish App" widthPx={colWidths.finishApp} onResizeStart={beginResize("finishApp")} {...gridNav("finishApp")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.finishApp)} onChange={(e) => setForm({ ...form, finishApp: e.target.value })} />
                </ExcelField>
              </ExcelRow>
            </ExcelBlock>

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Remark</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {/* Alert "perlu Improve dari Produksi" (2026-09-02, instruksi
                    eksplisit user) -- toggle, mirip lampu: merah = perlu
                    Improve, hijau = normal. Ditaruh di sebelah tombol "Upload
                    File" (instruksi eksplisit user), kotak berdiri sendiri
                    (bukan ExcelField/sel grid). Bagian dari data form biasa
                    (ikut tersimpan waktu Save/Simpan Perubahan) -- versi
                    INSTAN (langsung tersimpan tanpa perlu klik Save) ada di
                    tombol "Improve" per-baris di tab Lot History. */}
                <label style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>Tombol Improve:</label>
                <button
                  type="button"
                  className={form.needsImprove ? "btn btn-danger" : "btn btn-success"}
                  style={{ padding: "3px 12px" }}
                  disabled={improveTrialLoading}
                  onClick={async () => {
                    const turningOn = !form.needsImprove;
                    const order = form.order.trim();
                    // Riwayat Trial/Improve DIAMBIL FRESH langsung dari server di
                    // sini (2026-09-02 fix), BUKAN baca `existingApprovalsForOrder`
                    // (cache React Query) -- itu race condition kalau masuk mode
                    // Edit dari tombol Edit di tabel "Lot History" (BEDA dari panel
                    // "Multiple Cust" di tab Input yg baru tampil KALAU datanya
                    // sudah lebih dulu ke-load): query by-order belum tentu
                    // selesai fetch ulang saat admin langsung klik "Improve" abis
                    // itu, nomor Trial jadi salah hitung ulang dari 1. Fallback ke
                    // `existingApprovalsForOrder` kalau fetch fresh ini gagal
                    // (mis. Order masih kosong/offline sesaat), drpd macet total.
                    let historyRows = existingApprovalsForOrder;
                    if (order) {
                      setImproveTrialLoading(true);
                      try {
                        const res = await api.get<{ success: boolean; data: ApprovalRow[] }>(`/approvals/by-order/${encodeURIComponent(order)}`);
                        historyRows = res.data;
                      } catch {
                        /* fetch fresh gagal -- lanjut pakai existingApprovalsForOrder apa adanya */
                      } finally {
                        setImproveTrialLoading(false);
                      }
                    }
                    // Nyalakan -> Remark KENA TAMBAH baris "Trial N (NG) dd/mm/yy"
                    // baru. Matikan -> Remark KENA TAMBAH baris "Improve N dd/mm/yy"
                    // (N = nomor Trial yg baru diselesaikan). Riwayat SEBELUMNYA
                    // tetap ada di kedua arah (2026-09-02, instruksi eksplisit
                    // user, lihat appendNextImproveTrial/appendImproveResolved).
                    setForm((f) => ({
                      ...f,
                      needsImprove: turningOn,
                      remark: turningOn ? appendNextImproveTrial(f.remark, historyRows) : appendImproveResolved(f.remark, historyRows),
                    }));
                  }}
                >
                  {form.needsImprove ? "🔴 Improve" : "🟢 Normal"}
                </button>
                {attachFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachFile.name}</span>}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-success"
                type="submit"
                disabled={saveMutation.isPending || uploadMutation.isPending || !!duplicateOrderWarning || !orderConfirmed}
                title={
                  duplicateOrderWarning
                    ? 'Order ini sudah ada di History -- klik "Edit" atau "+ Baris Baru" dulu di atas.'
                    : !orderConfirmed
                    ? 'Order belum terkonfirmasi ketemu di Referensi Order / PO (SAP-COOISPI) -- ketik nomor Order lalu tekan Enter dulu.'
                    : undefined
                }
              >
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingApprovalId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingApprovalId && (
                <button type="button" className="btn btn-outline" onClick={cancelEdit}>
                  Batal Edit
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>Approval — Lot History</span>
            {user && ALLOWED_SYNC_NIKS.includes(user.nik) && (
              <button
                className="btn btn-outline"
                type="button"
                title='Timpa isi tab "New List Approval" di Google Sheet dengan data Lot History yang sedang ditampilkan (sesuai filter aktif)'
                onClick={() => {
                  setError("");
                  setMessage("");
                  syncSheetMutation.mutate();
                }}
                disabled={syncSheetMutation.isPending}
              >
                {syncSheetMutation.isPending ? "Sync..." : "🔄 Sync ke Google Sheet"}
              </button>
            )}
          </div>
          <div className="panel-body">
            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}
            <div className="field-grid" style={{ marginBottom: 12 }}>
              <div className="field">
                <label>Status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Semua</option>
                  <option value="Prepare Approval">Prepare Approval</option>
                  <option value="Pending Approval">Pending Approval</option>
                  <option value="Approval">Approval</option>
                  <option value="Oke Approval">Oke Approval</option>
                </select>
              </div>
              <div className="field">
                <label>Filter Kolom</label>
                <select value={filterCol} onChange={(e) => setFilterCol(e.target.value)}>
                  {FILTER_COLUMNS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Nilai</label>
                <input value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />
              </div>
            </div>

            <DataTable
              rowKey={(r: LotHistoryRow) => r.approvalId}
              exportFileName="approval-lot-history"
              storageKey="approval-lot-history"
              rows={historyQuery.data ?? []}
              rowStyle={(r) => (r.needsImprove ? { background: "#fef2f2" } : undefined)}
              freezeFirstColumn
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                {
                  key: "timestamp",
                  label: "Timestamp",
                  render: (r) => formatDateTime(r.timestamp),
                  csvValue: (r) => toExcelDateTimeString(r.timestamp),
                },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                { key: "mrpPic", label: "Mrp Pic", render: (r) => r.mrpPic },
                { key: "salesPic", label: "Sales Pic", render: (r) => r.salesPic },
                {
                  key: "prepareProduksi",
                  label: "Prepare Date",
                  render: (r) => formatDateTime(r.prepareProduksi),
                  csvValue: (r) => toExcelDateTimeString(r.prepareProduksi),
                },
                { key: "sprayMan", label: "Spray Man", render: (r) => r.sprayMan },
                { key: "wetSample", label: "Wet Sample", render: (r) => r.wetSample },
                { key: "panel", label: "Panel", render: (r) => r.panel },
                {
                  key: "lotCoa",
                  label: "Lot COA",
                  render: (r) => formatDateTime(r.lotCoa),
                  csvValue: (r) => toExcelDateTimeString(r.lotCoa),
                },
                {
                  key: "sendToTech",
                  label: "Send To Tech",
                  render: (r) => formatDateTime(r.sendToTech),
                  csvValue: (r) => toExcelDateTimeString(r.sendToTech),
                },
                {
                  key: "technicalDateReceiving",
                  label: "Submit Tech",
                  render: (r) => formatDateTime(r.technicalDateReceiving),
                  csvValue: (r) => toExcelDateTimeString(r.technicalDateReceiving),
                },
                {
                  key: "submitToCustomer",
                  label: "Submit Cust",
                  render: (r) => formatDateTime(r.submitToCustomer),
                  csvValue: (r) => toExcelDateTimeString(r.submitToCustomer),
                },
                { key: "customer", label: "Customer", render: (r) => r.customer },
                { key: "custSegmen", label: "Cust Segmen", render: (r) => r.custSegmen },
                { key: "multipleCust", label: "Multiple Cust", render: (r) => r.multipleCust },
                { key: "techName", label: "Tech Name", render: (r) => r.techName },
                {
                  key: "finishApp",
                  label: "Finish App",
                  render: (r) => formatDateTime(r.finishApp),
                  csvValue: (r) => toExcelDateTimeString(r.finishApp),
                },
                { key: "remark", label: "Remark", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
                { key: "status", label: "Status", render: (r) => r.status },
                {
                  key: "needsImprove",
                  label: "Improve",
                  // Badge merah/hijau, SAMA persis dgn tombol "Improve" di form
                  // Input/Edit (2026-09-02, instruksi eksplisit user -- dulu
                  // merah/putih, tidak konsisten dgn tombolnya). Bukan tombol
                  // beneran (tidak ada onClick) -- cuma tampilan status, sesuai
                  // instruksi sebelumnya toggle-nya cuma boleh lewat form.
                  render: (r) => (
                    <span className={r.needsImprove ? "btn btn-danger" : "btn btn-success"} style={{ padding: "3px 12px", fontSize: "0.8rem" }}>
                      {r.needsImprove ? "🔴 Improve" : "🟢 Normal"}
                    </span>
                  ),
                  csvValue: (r) => (r.needsImprove ? "Improve" : "Normal"),
                },
                { key: "processingTime", label: "Processing Time", render: (r) => r.processingTime },
                { key: "hasAttachment", label: "Lampiran", render: (r) => (r.hasAttachment ? "Filled" : "No File"), csvValue: (r) => (r.hasAttachment ? "Filled" : "No File") },
                { key: "pctGR", label: "% GR", render: (r) => r.pctGR ?? "-" },
                {
                  key: "actions",
                  label: "Aksi",
                  render: (r) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-outline" type="button" title="Edit" aria-label="Edit" style={{ padding: "6px 10px" }} onClick={() => startEdit(r)}>
                        ✏️
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        title="Lampiran"
                        aria-label="Lampiran"
                        style={{ padding: "6px 10px" }}
                        onClick={() => setAttachmentModalId(r.approvalId)}
                      >
                        📎
                      </button>
                      {getMenuLevel(user, "approval") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Approval untuk Order ${r.order}?`)) deleteMutation.mutate(r.approvalId);
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
          <div className="panel-header">List Antrian Approval</div>
          <div className="panel-body">
            <p style={{ marginTop: 0, marginBottom: 12, color: "var(--muted)", fontSize: "0.85rem" }}>
              Order yang Admin QC Stage-nya (menu Input Admin QC) sudah "Approval" atau "Joint Lot" dan sedang
              menunggu diinput ke Approval -- diurutkan yang paling lama menunggu duluan (FIFO). Order otomatis
              hilang dari daftar ini begitu sudah ada input Approval untuk Order tersebut, atau begitu Order itu
              sudah masuk Packing.
            </p>
            <input
              placeholder="Cari nomor Order..."
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: QueueRow) => r.order}
              exportFileName="list-antrian-approval"
              storageKey="approval-queue"
              rows={filteredQueue}
              columns={[
                { key: "order", label: "Order", render: (r) => r.order },
                { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription },
                { key: "batch", label: "Batch", render: (r) => r.batch },
                { key: "orderQty", label: "Order Qty", render: (r) => r.orderQty },
                { key: "plant", label: "Plant", render: (r) => r.plant },
                { key: "iuPlant", label: "IU Plant", render: (r) => r.iuPlant },
                { key: "codeTanki", label: "Code Tanki", render: (r) => r.codeTanki },
                { key: "typeLot", label: "Admin QC Stage", render: (r) => r.typeLot },
                {
                  key: "lotPassed",
                  label: "Lot Passed",
                  render: (r) => formatDateTime(r.lotPassed),
                  csvValue: (r) => toExcelDateTimeString(r.lotPassed),
                },
                {
                  key: "qcToApproval",
                  label: "QC to App",
                  render: (r) => formatDateTime(r.qcToApproval),
                  csvValue: (r) => toExcelDateTimeString(r.qcToApproval),
                },
                {
                  key: "qcPassed",
                  label: "QC Passed",
                  render: (r) => formatDateTime(r.qcPassed),
                  csvValue: (r) => toExcelDateTimeString(r.qcPassed),
                },
                { key: "remark", label: "Remark (Admin QC)", render: (r) => r.remark },
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
                      Input Approval
                    </button>
                  ),
                  csvValue: () => "",
                },
              ]}
            />
          </div>
        </div>
      )}

      {attachmentModalId && (
        <Modal title={`Lampiran — ${attachmentModalId}`} onClose={() => setAttachmentModalId(null)}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(attachmentsQuery.data ?? []).map((a) => (
              <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <a href={fileUrl(a.filePath)} target="_blank" rel="noreferrer">
                  {a.fileName}
                </a>
                {getMenuLevel(user, "approval") === "INPUT" && (
                  <button
                    className="btn btn-danger"
                    onClick={() => deleteAttachmentMutation.mutate({ approvalId: attachmentModalId, id: a.id })}
                  >
                    Hapus
                  </button>
                )}
              </li>
            ))}
            {(attachmentsQuery.data ?? []).length === 0 && <li>Belum ada lampiran.</li>}
          </ul>
        </Modal>
      )}

      {viewingApproval && (
        <Modal title={`Detail Baris — Order ${viewingApproval.order}`} onClose={() => setViewingApproval(null)} width={640}>
          <MultipleCustViewDetail row={viewingApproval} employees={employees} />
        </Modal>
      )}
    </div>
  );
}
