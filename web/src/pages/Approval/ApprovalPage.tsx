import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
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
  inputBy: string;
}

interface LotHistoryRow extends ApprovalRow {
  /** Diambil live dari MasterOrder ("Referensi Order / PO (SAP-COOISPI)")
   * lewat GET /approvals/lot-history di backend, bukan snapshot -- jadi
   * otomatis ikut berubah kalau Master Data Cooispi di-update ulang. */
  pctGR: string | null;
  status: "Pending Approval" | "Approval" | "Oke Approval";
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
  multipleCust: "",
  techName: "",
  techNameNik: null as string | null,
  finishApp: "",
  remark: "",
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
  ["prepareDate", "sprayMan", "wetSample", "panel", "lotCoa", "sendToTech"],
  ["submitTech", "submitCust", "customer", "custSegmen", "multipleCust", "techName", "finishApp"],
];

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
      const wasEditing = !!editingApprovalId;
      setForm(emptyForm);
      setEditingApprovalId(null);
      setDuplicateOrderWarning(null);
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
      queryClient.invalidateQueries({ queryKey: ["approval-queue"] });
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
    onSuccess: () => {
      setMessage("Data Approval berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["approval-lot-history"] });
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
    });
    setTab("input");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingApprovalId(null);
    setDuplicateOrderWarning(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
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
            {duplicateOrderWarning && !editingApprovalId && (
              <div
                style={{
                  background: "#fef3c7",
                  border: "1px solid #f59e0b",
                  borderRadius: 6,
                  padding: "10px 14px",
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: "0.85rem", color: "#92400e" }}>
                  ⚠️ Order <strong>{duplicateOrderWarning.order}</strong> sudah pernah diinput ke Approval oleh{" "}
                  {formatInputBy(employees, duplicateOrderWarning.inputBy)} pada {formatDateTime(duplicateOrderWarning.timestamp)}.
                  Kalau mau melengkapi/mengubah data yang sudah ada (bukan bikin baris baru), klik "Edit Baris yang Sudah Ada" -- Save
                  di sini tetap bisa dipakai kalau memang sengaja mau menambah baris terpisah utk Order ini (mis. Multiple Cust).
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={() => startEdit(duplicateOrderWarning)}>
                    Edit Baris yang Sudah Ada
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                    onClick={() => setDuplicateOrderWarning(null)}
                  >
                    Tutup
                  </button>
                </div>
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
                    }}
                    onFound={handleOrderFound}
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
                <ExcelField label="Multiple Cust" widthPx={colWidths.multipleCust} onResizeStart={beginResize("multipleCust")} {...gridNav("multipleCust")}>
                  {/* Textarea, 1 customer per baris (2026-09-01, instruksi
                      eksplisit user, mirip "tanki turunan" Milling tapi
                      free-text bukan pilih dari daftar tetap) -- kalau diisi
                      LEBIH DARI 1 baris SAAT SAVE BARIS BARU (bukan Edit),
                      tiap baris otomatis jadi 1 baris Approval TERPISAH di
                      Lot History, field lain disalin identik (lihat
                      saveMutation). Diisi 1 baris/kosong -> perilaku sama spt
                      sebelumnya (field teks biasa). */}
                  <textarea
                    rows={2}
                    value={form.multipleCust}
                    onChange={(e) => setForm({ ...form, multipleCust: e.target.value })}
                    placeholder="1 customer per baris kalau lebih dari 1"
                    title="Isi lebih dari 1 baris (1 customer per baris) utk otomatis membuat baris Approval terpisah per customer di Lot History saat Save."
                  />
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
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
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
    </div>
  );
}
