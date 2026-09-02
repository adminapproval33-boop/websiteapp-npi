import { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fileUrl } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import { ExcelBlock, ExcelRow, ExcelField } from "../../components/ExcelGrid";
import { formatInputBy, useEmployeeOptions } from "../../components/EmployeeNameSelect";
import { formatDateTime, toDateTimeLocalValue, toExcelDateTimeString, validateNotFutureDate } from "../../lib/datetime";
import { evaluateSpec, SPEC_VERDICT_COLOR, SPEC_VERDICT_LABEL } from "../../lib/specEval";
import { useResizableColWidths } from "../../lib/useResizableColWidths";
import { handleExcelGridKeyNav } from "../../lib/excelGridNav";
import { useAuth } from "../../auth/AuthContext";
import { getMenuLevel } from "../../lib/menuAccess";

/** Portal Quality Control > Input Admin QC (2026-07-28) -- header administratif
 * tahap QC (Admin QC Stage/Lot Passed/QC to App/QC Passed) disimpan di tabel
 * AdminQc TERPISAH dari Planning > Approval (lihat
 * server/prisma/schema.prisma), terhubung cuma lewat nomor Order. Spec
 * Parameters di bawahnya BUKAN data baru -- itu CheckResult/CheckResultParameter
 * yg SAMA PERSIS dgn menu "Input Check Results", ditampilkan di sini SEBAGAI
 * REFERENSI VIEW-ONLY (2026-07-29, revisi eksplisit user -- Admin QC cuma
 * boleh lihat, edit/isi Spec Parameters HANYA lewat menu "Input Check
 * Results"). Sebelumnya bisa diedit dari 2 halaman; sekarang cuma 1. */

interface AdminQcRow {
  adminQcId: string;
  timestamp: string;
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
  inputBy: string;
}

interface AdminQcHistoryRow extends AdminQcRow {
  attachments: { id: number; fileName: string; filePath: string }[];
}

interface ParamRow {
  no: number;
  parameter: string;
  standard: string;
  result: string;
  remark: string;
  start: string;
  finish: string;
  pic: string;
}

interface CheckRow {
  checkId: string;
  order: string;
  materialNumber: string | null;
  materialDescription: string | null;
  batch: string | null;
  customer: string | null;
  custSegmen: string | null;
  orderQty: string | null;
  plant: string | null;
  iuPlant: string | null;
  lotCoa: string | null;
  codeTanki: string | null;
  remark: string | null;
  appearanceNotes: string | null;
  checkNotes: string | null;
  parameters: ParamRow[];
}

interface LinkedSpecParameter {
  no: number;
  itemCheck: string;
  standardSpec: string | null;
  unit: string | null;
}

interface LinkedSpec {
  specId: string;
  parameters: LinkedSpecParameter[];
}

/** Cuma nyimpen checkId Check Results yg terhubung ke Order ini (kalau ada) --
 * dipakai buat teks "Terhubung ke Check Results X" di bawah. Field CheckResult
 * lain (Customer/Cust Segmen/Lot COA/dll) TIDAK perlu disimpan di sini lagi
 * karena Spec Parameters di halaman ini VIEW-ONLY (2026-07-29) -- tidak ada
 * lagi write-back ke Check Results dari Admin QC. */
interface CheckPassthrough {
  checkId: string | null;
}

const emptyCheckPassthrough: CheckPassthrough = {
  checkId: null,
};

function paramRowFromSpec(p: LinkedSpecParameter): ParamRow {
  return {
    no: p.no,
    parameter: p.itemCheck,
    standard: [p.standardSpec, p.unit].filter(Boolean).join(" "),
    result: "",
    remark: "",
    start: "",
    finish: "",
    pic: "",
  };
}

const emptyForm = {
  order: "",
  materialNumber: "",
  materialDescription: "",
  batch: "",
  orderQty: "",
  plant: "",
  iuPlant: "",
  codeTanki: "",
  typeLot: "",
  lotPassed: "",
  qcToApproval: "",
  qcPassed: "",
  remark: "",
};

const HEADER_COL_DEFAULT_WIDTHS: Record<string, number> = {
  order: 140,
  materialNumber: 140,
  materialDescription: 240,
  batch: 120,
  orderQty: 110,
  plant: 100,
  iuPlant: 140,
  codeTanki: 140,
  typeLot: 160,
  lotPassed: 170,
  qcToApproval: 170,
  qcPassed: 170,
};

const HEADER_COL_ROWS: string[][] = [
  ["order", "materialNumber", "materialDescription", "batch", "orderQty", "plant"],
  ["iuPlant", "codeTanki", "typeLot", "lotPassed", "qcToApproval", "qcPassed"],
];

const SPEC_TABLE_DEFAULT_WIDTHS: Record<string, number> = {
  no: 44,
  itemCheck: 220,
  spec: 130,
  result: 90,
  verdict: 90,
  start: 180,
  finish: 180,
  pic: 110,
};

/** Header tabel Spec Parameters dengan drag-handle di kanan utk mengubah lebar kolom bebas. */
function ResizableHeader({ width, onResizeStart, children }: { width: number; onResizeStart: (e: ReactMouseEvent) => void; children: ReactNode }) {
  return (
    <th style={{ width, position: "relative" }}>
      {children}
      <div onMouseDown={onResizeStart} style={{ position: "absolute", right: 0, top: 0, height: "100%", width: 6, cursor: "col-resize" }} />
    </th>
  );
}

export default function AdminQcPage() {
  const { data: employees } = useEmployeeOptions();
  const { data: tanks } = useTankOptions();
  const { user } = useAuth();
  const isViewOnly = getMenuLevel(user, "adminQc") === "VIEW";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"input" | "history">(() => (isViewOnly ? "history" : "input"));
  const [form, setForm] = useState(emptyForm);
  /** Admin QC Stage "Assorted (NG)" (2026-09-01, instruksi eksplisit user):
   * Lot Passed/QC to App jadi tidak relevan (barang langsung di-assort,
   * bukan lewat Lot Passed/Approval) -- kolomnya dikunci nonaktif & dipaksa
   * kosong ("-"), sementara QC Passed JADI WAJIB (kebalikan dari stage lain
   * yg cuma Lot Packing yg mewajibkan QC Passed). Dipakai bareng oleh JSX
   * (kunci input) & saveMutation (paksa Lot Passed/QC to App kosong walau
   * form state-nya somehow masih kesisa nilai lama, mis. dari Edit baris yg
   * stage-nya baru diganti ke Assorted (NG)). */
  const isAssortedNg = form.typeLot === "Assorted (NG)";
  const [params, setParams] = useState<ParamRow[]>([]);
  const [checkPassthrough, setCheckPassthrough] = useState<CheckPassthrough>(emptyCheckPassthrough);
  /** Nilai "Appearance Check Results" (form.remark) PERSIS seperti saat
   * dimuat (dari CheckResult.appearanceNotes yg sudah gabungan/kombinasi,
   * atau dari Admin QC sendiri kalau Order ini blm py Check Results) --
   * dipakai saveMutation utk tahu apa saja yg BERUBAH (2026-08-05, instruksi
   * eksplisit user: sinkron 2 arah harus APPEND entri baru, bukan overwrite
   * -- kalau isinya sama persis dgn baseline ini, Save tidak perlu kirim
   * apa-apa ke Check Results supaya tidak dobel entri percuma). */
  const [remarkBaseline, setRemarkBaseline] = useState("");
  const [specStatus, setSpecStatus] = useState<"idle" | "loading" | "found" | "not-found">("idle");
  const [editingAdminQcId, setEditingAdminQcId] = useState<string | null>(null);
  const [lastSavedAdminQcId, setLastSavedAdminQcId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachmentModalId, setAttachmentModalId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { widths: headerColWidths, beginResize: beginHeaderResize, guideX, reset: resetHeaderColWidths } = useResizableColWidths(
    HEADER_COL_DEFAULT_WIDTHS,
    "adminQcHeaderColWidths",
    HEADER_COL_ROWS
  );
  /** Navigasi panah ala Excel antar ExcelField -- lihat lib/excelGridNav.ts.
   * "Admin QC Stage" pakai <select> native -- otomatis dilewati (lihat
   * usesNativeArrowBehavior di excelGridNav.ts) supaya panah tetap bisa
   * dipakai ganti opsi dropdown seperti biasa. */
  const gridNav = (key: string) => ({ navKey: key, onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleExcelGridKeyNav(e, HEADER_COL_ROWS) });
  const { widths: specColWidths, beginResize: beginSpecResize, reset: resetSpecColWidths } = useResizableColWidths(
    SPEC_TABLE_DEFAULT_WIDTHS,
    "adminQcSpecColWidths"
  );

  function resetAllColWidths() {
    resetHeaderColWidths();
    resetSpecColWidths();
  }

  const historyQuery = useQuery({
    queryKey: ["admin-qc-history"],
    queryFn: () => api.get<{ success: boolean; data: AdminQcHistoryRow[] }>("/admin-qc/history").then((r) => r.data),
  });

  const attachmentsQuery = useQuery({
    queryKey: ["admin-qc-attachments-modal", attachmentModalId],
    queryFn: () =>
      (historyQuery.data ?? []).find((r) => r.adminQcId === attachmentModalId)?.attachments ?? [],
    enabled: !!attachmentModalId,
  });

  async function loadSpecForMaterial(materialNumber: string) {
    const matNo = materialNumber.trim();
    if (!matNo) {
      setSpecStatus("idle");
      setParams([]);
      return;
    }
    setSpecStatus("loading");
    try {
      const res = await api.get<{ success: boolean; data: LinkedSpec }>(`/product-specs/by-material/${encodeURIComponent(matNo)}`);
      setParams(res.data.parameters.map(paramRowFromSpec));
      setSpecStatus("found");
    } catch {
      setParams([]);
      setSpecStatus("not-found");
    }
  }

  async function handleOrderFound(data: OrderRefData) {
    setForm((f) => ({
      ...f,
      materialNumber: data.materialNumber ?? "",
      materialDescription: data.materialDescription ?? "",
      batch: data.batch ?? "",
      orderQty: data.orderQty ?? "",
      plant: data.plant ?? "",
    }));

    setEditingAdminQcId(null);
    setLastSavedAdminQcId(null);
    try {
      const res = await api.get<{ success: boolean; data: AdminQcRow | null }>(`/admin-qc/latest-by-order/${encodeURIComponent(data.order)}`);
      if (res.data) {
        const latest = res.data;
        setEditingAdminQcId(latest.adminQcId);
        setLastSavedAdminQcId(latest.adminQcId);
        setForm((f) => ({
          ...f,
          iuPlant: f.iuPlant || latest.iuPlant || "",
          codeTanki: f.codeTanki || latest.codeTanki || "",
          typeLot: f.typeLot || latest.typeLot || "",
          lotPassed: f.lotPassed || latest.lotPassed || "",
          qcToApproval: f.qcToApproval || latest.qcToApproval || "",
          qcPassed: f.qcPassed || latest.qcPassed || "",
          // Prefill sementara dari Admin QC terakhir -- ditimpa lagi di bawah
          // kalau Order ini ternyata terhubung ke Check Results (itu sumber
          // yg lebih otoritatif, sudah gabungan semua entri Admin QC lama).
          remark: latest.remark || "",
        }));
        setRemarkBaseline(latest.remark || "");
      }
    } catch {
      /* belum ada histori Admin QC utk Order ini -- biarkan kosong */
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
      /* saran IU Plant/Code Tanki bersifat opsional -- kalau gagal, biarkan user isi manual */
    }

    // Spec Parameters -- prioritaskan Check Results yg SUDAH ADA utk Order ini
    // (data yg sama dgn "Input Check Results"); kalau belum ada sama sekali,
    // fallback ke Product Spek berdasarkan Material Number, sama pola dgn
    // CheckResultsPage.tsx.
    try {
      const cr = await api.get<{ success: boolean; data: CheckRow | null }>(`/check-results/by-order/${encodeURIComponent(data.order)}`);
      if (cr.data) {
        setCheckPassthrough({ checkId: cr.data.checkId });
        setParams(
          cr.data.parameters.map((p) => ({
            no: p.no,
            parameter: p.parameter,
            standard: p.standard ?? "",
            result: p.result ?? "",
            remark: p.remark ?? "",
            start: p.start ?? "",
            finish: p.finish ?? "",
            pic: p.pic ?? "",
          }))
        );
        // "Appearance Check Results" (2026-08-05, instruksi eksplisit user) --
        // otomatis terisi dari appearanceNotes Check Results Order ini (sumber
        // OTORITATIF, sudah gabungan semua entri Admin QC sebelumnya -- lihat
        // endpoint PUT /check-results/:checkId/appearance-notes), MENIMPA
        // prefill sementara dari Admin QC terakhir di atas. Baseline-nya juga
        // ikut di-set sama supaya saveMutation tahu apa yg benar2 baru diketik
        // admin dari sini (tidak sekadar apa yg dimuat ulang).
        const combinedNotes = cr.data!.appearanceNotes ?? "";
        setForm((f) => ({ ...f, remark: combinedNotes }));
        setRemarkBaseline(combinedNotes);
        setSpecStatus("found");
      } else {
        setCheckPassthrough(emptyCheckPassthrough);
        await loadSpecForMaterial(data.materialNumber ?? "");
      }
    } catch {
      setCheckPassthrough(emptyCheckPassthrough);
      await loadSpecForMaterial(data.materialNumber ?? "");
    }
  }

  function resetForm() {
    setForm(emptyForm);
    setParams([]);
    setCheckPassthrough(emptyCheckPassthrough);
    setSpecStatus("idle");
    setEditingAdminQcId(null);
    setRemarkBaseline("");
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Spec Parameters (params) TETAP view-only di halaman ini -- Admin QC
      // tidak pernah menulis balik ke situ. TAPI Appearance Check Results
      // (form.remark) SEKARANG sinkron 2 arah (2026-08-05, instruksi eksplisit
      // user, revisi: APPEND bukan overwrite -- lihat komentar
      // remarkBaseline). Kalau Order ini terhubung ke 1 Check Results DAN
      // teksnya berubah dari baseline yg dimuat, Save di sini juga mengirim
      // teks itu sbg entri BARU ke CheckResult.appearanceNotes lewat endpoint
      // sempit khusus 1 field itu (backend yg urus format append-nya, lihat
      // PUT /check-results/:checkId/appearance-notes di checkResults.routes.ts).
      // Kalau tidak berubah, tidak dikirim apa2 (hindari entri dobel percuma
      // tiap kali Save Admin QC utk alasan lain, mis. ubah QC Passed doang).
      // Kegagalan sync ini SENGAJA tidak menggagalkan save Admin QC-nya
      // sendiri (data header Admin QC sudah kepalang tersimpan) -- cuma
      // ditambahkan ke pesan sukses sbg peringatan.
      // Assorted (NG) (2026-09-01, instruksi eksplisit user): Lot Passed/QC to
      // App dipaksa kosong di payload yg dikirim, TIDAK PEDULI apa isi form
      // state-nya (defense-in-depth -- field-nya sendiri sudah dikunci/di-clear
      // di JSX & saat ganti Admin QC Stage, ini jaga2 kalau somehow masih ada
      // nilai lama nyangkut, mis. dari baris Edit yg stage-nya baru diganti).
      const payload = isAssortedNg ? { ...form, lotPassed: "", qcToApproval: "" } : form;
      const res = editingAdminQcId
        ? await api.put<{ success: boolean; data: AdminQcRow }>(`/admin-qc/${editingAdminQcId}`, payload)
        : await api.post<{ success: boolean; data: AdminQcRow }>("/admin-qc", payload);
      let syncWarning = "";
      const trimmedRemark = form.remark.trim();
      if (checkPassthrough.checkId && trimmedRemark && trimmedRemark !== remarkBaseline.trim()) {
        try {
          await api.put(`/check-results/${checkPassthrough.checkId}/appearance-notes`, { note: trimmedRemark });
        } catch {
          syncWarning = " (Peringatan: gagal menyinkronkan ke Input Check Results, coba Save ulang.)";
        }
      }
      return { ...res, syncWarning };
    },
    onSuccess: (res) => {
      setError("");
      const wasEditing = editingAdminQcId;
      const savedId = res.data.adminQcId;
      resetForm();
      setLastSavedAdminQcId(savedId);
      queryClient.invalidateQueries({ queryKey: ["admin-qc-history"] });
      queryClient.invalidateQueries({ queryKey: ["check-results-history"] });
      if (attachFile) {
        uploadMutation.mutate({ adminQcId: savedId, file: attachFile });
      } else {
        setMessage((wasEditing ? "Data Admin QC berhasil diperbarui." : "Data Admin QC berhasil disimpan.") + res.syncWarning);
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menyimpan data."),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ adminQcId, file }: { adminQcId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/admin-qc/${adminQcId}/attachments`, formData);
    },
    onSuccess: () => {
      setMessage("Data & lampiran berhasil disimpan.");
      setAttachFile(null);
      queryClient.invalidateQueries({ queryKey: ["admin-qc-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Data tersimpan, tapi gagal mengunggah lampiran."),
  });

  const deleteMutation = useMutation({
    mutationFn: (adminQcId: string) => api.delete(`/admin-qc/${adminQcId}`),
    onSuccess: () => {
      setMessage("Data Admin QC berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["admin-qc-history"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal menghapus data."),
  });

  function startEdit(row: AdminQcHistoryRow) {
    setEditingAdminQcId(row.adminQcId);
    setLastSavedAdminQcId(row.adminQcId);
    setForm({
      order: row.order,
      materialNumber: row.materialNumber ?? "",
      materialDescription: row.materialDescription ?? "",
      batch: row.batch ?? "",
      orderQty: row.orderQty ?? "",
      plant: row.plant ?? "",
      iuPlant: row.iuPlant ?? "",
      codeTanki: row.codeTanki ?? "",
      typeLot: row.typeLot ?? "",
      lotPassed: row.lotPassed ?? "",
      qcToApproval: row.qcToApproval ?? "",
      qcPassed: row.qcPassed ?? "",
      remark: row.remark ?? "",
    });
    setRemarkBaseline(row.remark ?? "");
    void (async () => {
      try {
        const cr = await api.get<{ success: boolean; data: CheckRow | null }>(`/check-results/by-order/${encodeURIComponent(row.order)}`);
        if (cr.data) {
          setCheckPassthrough({ checkId: cr.data.checkId });
          setParams(
            cr.data.parameters.map((p) => ({
              no: p.no,
              parameter: p.parameter,
              standard: p.standard ?? "",
              result: p.result ?? "",
              remark: p.remark ?? "",
              start: p.start ?? "",
              finish: p.finish ?? "",
              pic: p.pic ?? "",
            }))
          );
          // Sama spt handleOrderFound -- appearanceNotes Check Results adalah
          // sumber otoritatif (sudah gabungan), timpa prefill row.remark di atas.
          const combinedNotes = cr.data!.appearanceNotes ?? "";
          setForm((f) => ({ ...f, remark: combinedNotes }));
          setRemarkBaseline(combinedNotes);
          setSpecStatus("found");
        } else {
          setCheckPassthrough(emptyCheckPassthrough);
          await loadSpecForMaterial(row.materialNumber ?? "");
        }
      } catch {
        setCheckPassthrough(emptyCheckPassthrough);
      }
    })();
    setTab("input");
    setMessage("");
    setError("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isKnownTankCode(tanks, form.codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
    const dateError =
      validateNotFutureDate(form.lotPassed, "Lot Passed") ??
      validateNotFutureDate(form.qcToApproval, "QC to App") ??
      validateNotFutureDate(form.qcPassed, "QC Passed");
    if (dateError) {
      setError(dateError);
      return;
    }
    saveMutation.mutate();
  }

  const filteredHistory = (historyQuery.data ?? []).filter((row) =>
    search.trim() ? row.order.toLowerCase().includes(search.trim().toLowerCase()) : true
  );

  /** Wajib/tidaknya Lot Passed/QC to App/QC Passed mengikuti aturan per-stage
   * yang SAMA PERSIS dengan validasi backend (lihat superRefine di
   * server/src/modules/adminQc/adminQc.routes.ts) -- "Lot Packing" & "Approval"
   * TETAP pakai aturan lama (Lot Packing skip QC to App krn langsung Packing
   * tanpa Approval; Approval skip Lot Passed/QC Passed), TIDAK ikut "wajib
   * semua". Appearance Check Results (remark) & aturan "Joint Lot" utk QC
   * Passed/QC to App adalah kolom yg DIUBAH 2026-08-11 (instruksi eksplisit
   * user): Joint Lot jadi TIDAK mewajibkan QC Passed/QC to App/remark;
   * stage lain (termasuk Improve) tetap wajib isi remark. "Assorted (NG)"
   * ditambahkan 2026-09-01 (instruksi eksplisit user): Lot Passed/QC to App
   * TIDAK PERNAH wajib (kolomnya dikunci nonaktif, lihat `isAssortedNg` &
   * JSX-nya), sebaliknya QC Passed JADI WAJIB -- pola requirement-nya persis
   * kebalikan dari stage lain. */
  const jointLot = form.typeLot === "Joint Lot";
  const lotPassedRequired = form.typeLot === "Lot Packing" || jointLot;
  const qcToApprovalRequired = form.typeLot === "Approval";
  const qcPassedRequired = form.typeLot === "Lot Packing" || isAssortedNg;
  const remarkRequired = !jointLot;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {!isViewOnly && (
          <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
            Input Admin QC
          </button>
        )}
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "input" && (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-body">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button type="button" className="btn btn-outline" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={resetAllColWidths}>
                ↺ Reset Lebar Kolom
              </button>
            </div>
            <ExcelBlock title="Portal Quality Control » Input Admin QC">
              {guideX !== null && <div className="col-align-guide" style={{ left: guideX }} />}
              <ExcelRow>
                <ExcelField label="Order" widthPx={headerColWidths.order} onResizeStart={beginHeaderResize("order")} {...gridNav("order")}>
                  <OrderLookup
                    bare
                    value={form.order}
                    onChange={(v) => setForm({ ...form, order: v })}
                    onFound={handleOrderFound}
                    onNotFound={() =>
                      handleOrderFound({
                        order: form.order,
                        batch: null,
                        materialNumber: null,
                        materialDescription: null,
                        orderQty: null,
                        plant: null,
                        jenis: null,
                        warnaDasar: null,
                        volume: null,
                      })
                    }
                  />
                </ExcelField>
                <ExcelField label="Material Number" widthPx={headerColWidths.materialNumber} onResizeStart={beginHeaderResize("materialNumber")} {...gridNav("materialNumber")}>
                  <input value={form.materialNumber} onChange={(e) => setForm({ ...form, materialNumber: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Material Description" widthPx={headerColWidths.materialDescription} onResizeStart={beginHeaderResize("materialDescription")} {...gridNav("materialDescription")}>
                  <input value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Batch" widthPx={headerColWidths.batch} onResizeStart={beginHeaderResize("batch")} {...gridNav("batch")}>
                  <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Order Qty" widthPx={headerColWidths.orderQty} onResizeStart={beginHeaderResize("orderQty")} {...gridNav("orderQty")}>
                  <input value={form.orderQty} onChange={(e) => setForm({ ...form, orderQty: e.target.value })} required />
                </ExcelField>
                <ExcelField label="Plant" widthPx={headerColWidths.plant} onResizeStart={beginHeaderResize("plant")} {...gridNav("plant")}>
                  <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} required />
                </ExcelField>
              </ExcelRow>
              <ExcelRow>
                <ExcelField label="IU Plant" widthPx={headerColWidths.iuPlant} onResizeStart={beginHeaderResize("iuPlant")} {...gridNav("iuPlant")}>
                  <IuPlantSelect bare id="admin-qc-iu-plant" value={form.iuPlant} plant={form.plant} onChange={(v) => setForm({ ...form, iuPlant: v })} required />
                </ExcelField>
                <ExcelField label="Code Tanki" widthPx={headerColWidths.codeTanki} onResizeStart={beginHeaderResize("codeTanki")} {...gridNav("codeTanki")}>
                  <TankSelect bare id="admin-qc-tank" value={form.codeTanki} onChange={(v) => setForm({ ...form, codeTanki: v })} />
                </ExcelField>
                <ExcelField label="Admin QC Stage" widthPx={headerColWidths.typeLot} onResizeStart={beginHeaderResize("typeLot")} {...gridNav("typeLot")}>
                  <select
                    value={form.typeLot}
                    onChange={(e) => {
                      const typeLot = e.target.value;
                      // Assorted (NG) (2026-09-01, instruksi eksplisit user):
                      // begitu stage ini dipilih, Lot Passed/QC to App langsung
                      // dikosongkan (field-nya jadi terkunci "-" di bawah, lihat
                      // isAssortedNg) -- supaya tidak ada nilai lama nyangkut
                      // begitu balik pindah stage lalu pindah lagi ke sini.
                      setForm((f) => ({
                        ...f,
                        typeLot,
                        lotPassed: typeLot === "Assorted (NG)" ? "" : f.lotPassed,
                        qcToApproval: typeLot === "Assorted (NG)" ? "" : f.qcToApproval,
                      }));
                    }}
                    required
                  >
                    <option value="">-- Pilih --</option>
                    <option value="Joint Lot">Joint Lot</option>
                    <option value="Lot Packing">Lot Packing</option>
                    <option value="Approval">Approval</option>
                    <option value="Improve">Improve</option>
                    <option value="Assorted (NG)">Assorted (NG)</option>
                  </select>
                </ExcelField>
                <ExcelField label="Lot Passed" widthPx={headerColWidths.lotPassed} onResizeStart={beginHeaderResize("lotPassed")} {...gridNav("lotPassed")}>
                  {isAssortedNg ? (
                    <input value="-" readOnly disabled title="Tidak berlaku utk Admin QC Stage 'Assorted (NG)'." />
                  ) : (
                    <input type="datetime-local" value={toDateTimeLocalValue(form.lotPassed)} onChange={(e) => setForm({ ...form, lotPassed: e.target.value })} required={lotPassedRequired} />
                  )}
                </ExcelField>
                <ExcelField label="QC to App" widthPx={headerColWidths.qcToApproval} onResizeStart={beginHeaderResize("qcToApproval")} {...gridNav("qcToApproval")}>
                  {isAssortedNg ? (
                    <input value="-" readOnly disabled title="Tidak berlaku utk Admin QC Stage 'Assorted (NG)'." />
                  ) : (
                    <input type="datetime-local" value={toDateTimeLocalValue(form.qcToApproval)} onChange={(e) => setForm({ ...form, qcToApproval: e.target.value })} required={qcToApprovalRequired} />
                  )}
                </ExcelField>
                <ExcelField label="QC Passed" widthPx={headerColWidths.qcPassed} onResizeStart={beginHeaderResize("qcPassed")} {...gridNav("qcPassed")}>
                  <input type="datetime-local" value={toDateTimeLocalValue(form.qcPassed)} onChange={(e) => setForm({ ...form, qcPassed: e.target.value })} required={qcPassedRequired} />
                </ExcelField>
              </ExcelRow>
            </ExcelBlock>

            <h3 className="pp-section-title" style={{ marginTop: 18 }}>
              Spec Parameters
            </h3>
            {specStatus === "idle" && (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Cari Order dulu supaya Spec Parameters otomatis terisi.</p>
            )}
            {specStatus === "loading" && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Memuat Spec Parameters...</p>}
            {specStatus === "not-found" && (
              <p className="error-text">
                Belum ada Check Results maupun Product Spek untuk Order/Material Number "{form.materialNumber}". Isi dulu
                di menu <strong>Input Check Results</strong> atau <strong>Creating Product Spek</strong>.
              </p>
            )}
            {specStatus === "found" && (
              <p className="status-text">
                {checkPassthrough.checkId ? `Terhubung ke Check Results ${checkPassthrough.checkId}` : "Spec Parameters dari Product Spek"} (
                {params.length} item check).
              </p>
            )}
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Tabel di bawah ini hanya tampilan (view-only) -- untuk mengisi/mengubah Result, Start, Finish, atau PIC,
              gunakan menu <strong>Input Check Results</strong>.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <ResizableHeader width={specColWidths.no} onResizeStart={beginSpecResize("no")}>No</ResizableHeader>
                    <ResizableHeader width={specColWidths.itemCheck} onResizeStart={beginSpecResize("itemCheck")}>Item Check</ResizableHeader>
                    <ResizableHeader width={specColWidths.spec} onResizeStart={beginSpecResize("spec")}>Spec</ResizableHeader>
                    <ResizableHeader width={specColWidths.result} onResizeStart={beginSpecResize("result")}>Result</ResizableHeader>
                    <ResizableHeader width={specColWidths.verdict} onResizeStart={beginSpecResize("verdict")}>Verdict</ResizableHeader>
                    <ResizableHeader width={specColWidths.start} onResizeStart={beginSpecResize("start")}>Start</ResizableHeader>
                    <ResizableHeader width={specColWidths.finish} onResizeStart={beginSpecResize("finish")}>Finish</ResizableHeader>
                    <ResizableHeader width={specColWidths.pic} onResizeStart={beginSpecResize("pic")}>PIC</ResizableHeader>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p, idx) => {
                    const verdict = evaluateSpec(p.standard, p.result, p.parameter);
                    return (
                      <tr key={idx}>
                        <td style={{ width: 40 }}>{p.no}</td>
                        <td>{p.parameter}</td>
                        <td>{p.standard || "-"}</td>
                        <td style={{ background: SPEC_VERDICT_COLOR[verdict] }}>{p.result || "-"}</td>
                        <td>{SPEC_VERDICT_LABEL[verdict]}</td>
                        <td>{formatDateTime(p.start)}</td>
                        <td>{formatDateTime(p.finish)}</td>
                        <td>{p.pic || "-"}</td>
                      </tr>
                    );
                  })}
                  {params.length === 0 && (
                    <tr>
                      <td colSpan={8}>Belum ada Spec Parameters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Appearance Check Results</label>
                <button type="button" className="btn btn-info" style={{ padding: "3px 12px" }} onClick={() => fileInputRef.current?.click()}>
                  Upload File
                </button>
                {attachFile && <span style={{ fontSize: 12, color: "var(--muted)" }}>{attachFile.name}</span>}
                <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)} />
              </div>
              <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Otomatis terisi dari Appearance Check Results yang sudah diinput di menu Input Check Results untuk Order
                ini. Kalau isi kolom ini diubah lalu di-Save, teksnya akan <strong>ditambahkan sebagai temuan baru</strong>{" "}
                (bukan menimpa) ke Appearance Check Results Order ini -- jadi riwayat pengecekan sebelumnya tetap
                tersimpan, tidak hilang.
              </p>
              <textarea rows={5} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} required={remarkRequired} />
            </div>

            {error && <p className="error-text">{error}</p>}
            {message && <p className="status-text">{message}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-success" type="submit" disabled={saveMutation.isPending || uploadMutation.isPending}>
                {saveMutation.isPending || uploadMutation.isPending ? "Menyimpan..." : editingAdminQcId ? "Simpan Perubahan" : "Save Data"}
              </button>
              {editingAdminQcId && (
                <button type="button" className="btn btn-outline" onClick={resetForm}>
                  Batal Edit
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {tab === "history" && (
        <div className="panel">
          <div className="panel-header">History Admin QC</div>
          <div className="panel-body">
            <input
              placeholder="Cari nomor Order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <DataTable
              rowKey={(r: AdminQcHistoryRow) => r.adminQcId}
              exportFileName="history-admin-qc"
              storageKey="admin-qc-history"
              rows={filteredHistory}
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
                { key: "remark", label: "Appearance Check Results", render: (r) => r.remark },
                { key: "inputBy", label: "Input By", render: (r) => formatInputBy(employees, r.inputBy) },
                { key: "attachments", label: "Lampiran", render: (r) => (r.attachments.length ? `${r.attachments.length} file` : "-") },
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
                        onClick={() => setAttachmentModalId(r.adminQcId)}
                      >
                        📎
                      </button>
                      {getMenuLevel(user, "adminQc") === "INPUT" && (
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          style={{ padding: "6px 10px" }}
                          onClick={() => {
                            if (confirm(`Hapus data Admin QC untuk Order ${r.order}?`)) deleteMutation.mutate(r.adminQcId);
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

      {attachmentModalId && (
        <Modal title={`Lampiran — ${attachmentModalId}`} onClose={() => setAttachmentModalId(null)}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(attachmentsQuery.data ?? []).map((a) => (
              <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <a href={fileUrl(a.filePath)} target="_blank" rel="noreferrer">
                  {a.fileName}
                </a>
              </li>
            ))}
            {(attachmentsQuery.data ?? []).length === 0 && <li>Belum ada lampiran.</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}
