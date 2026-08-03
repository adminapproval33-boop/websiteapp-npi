import { ChangeEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";
import { formatDateTime } from "../../lib/datetime";

interface MasterOrderRow {
  order: string;
  batch: string | null;
  materialNumber: string | null;
  materialDescription: string | null;
  orderQty: string | null;
  plant: string | null;
  deliveredQtyLiter: string | null;
  basicStartDate: string | null;
  basicFinishDate: string | null;
  systemStatus: string | null;
  unitOfMeasure: string | null;
  pctGR: string | null;
  actStartDate: string | null;
  actEndDate: string | null;
  volume: string | null;
  deliveredQtyPcs: string | null;
  orderQtyPcs: string | null;
  abcIndicatorDescription: string | null;
  todayAtp: string | null;
  t7Atp: string | null;
  jenis: string | null;
  warnaDasar: string | null;
  documentHeaderText: string | null;
  abcIndicator: string | null;
  orderType: string | null;
}

const ORDER_COLUMN_DEFS: { key: keyof MasterOrderRow; label: string }[] = [
  { key: "order", label: "Order" },
  { key: "materialNumber", label: "Material Number" },
  { key: "materialDescription", label: "Material description" },
  { key: "batch", label: "Batch" },
  { key: "deliveredQtyLiter", label: "Delivered quantity (GMEIN)/LITER" },
  { key: "orderQty", label: "Order quantity (GMEIN)/LITER" },
  { key: "plant", label: "Plant" },
  { key: "basicStartDate", label: "Basic start date" },
  { key: "basicFinishDate", label: "Basic finish date" },
  { key: "systemStatus", label: "System Status" },
  { key: "unitOfMeasure", label: "Unit of measure (=GMEIN)" },
  { key: "pctGR", label: "% GR" },
  { key: "actStartDate", label: "ACT START DATE" },
  { key: "actEndDate", label: "ACT END DATE" },
  { key: "volume", label: "VOLUME" },
  { key: "deliveredQtyPcs", label: "Delivered quantity (GMEIN) Pcs" },
  { key: "orderQtyPcs", label: "Order quantity (GMEIN) Pcs" },
  { key: "abcIndicatorDescription", label: "ABC Indicator description" },
  { key: "todayAtp", label: "Today-Atp" },
  { key: "t7Atp", label: "T+7-Atp" },
  { key: "jenis", label: "JENIS" },
  { key: "warnaDasar", label: "WARNA DASAR" },
  { key: "documentHeaderText", label: "Document Header Text" },
  { key: "abcIndicator", label: "ABC Indicator" },
  { key: "orderType", label: "Order Type" },
];

const ORDER_COLUMNS = ORDER_COLUMN_DEFS.map((c) => ({
  key: c.key,
  label: c.label,
  render: (r: MasterOrderRow) => r[c.key] ?? "-",
}));

interface MasterTankRow {
  code: string;
  taTb: string | null;
  tankCapacity: string | null;
  newNumber: string | null;
  locationPlant: string | null;
  typeTanki: string | null;
}

interface MasterMesinRow {
  code: string;
  lokasi: string | null;
}

interface MasterEmployeeRow {
  employeeId: string;
  fullName: string;
  organization: string | null;
  jobPosition: string | null;
  departemen: string | null;
  plant: string | null;
}

interface MaterialFlowRow {
  materialNumber: string;
  materialDescription: string | null;
  premixRequired: boolean;
  millingRequired: boolean;
  aftermixRequired: boolean;
  colourMatchingRequired: boolean;
  qcRequired: boolean;
  approvalRequired: boolean;
  packingRequired: boolean;
}

interface LastUpdated {
  cooispi: string | null;
  tanki: string | null;
  mesin: string | null;
  employee: string | null;
  flow: string | null;
}

function LastUpdatedNote({ value }: { value: string | null | undefined }) {
  return (
    <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
      Terakhir diupdate:{" "}
      <strong style={{ color: "var(--text)" }}>{value ? formatDateTime(value) : "Belum pernah diimpor"}</strong>
    </p>
  );
}

function FlowBadge({ on }: { on: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 22,
        textAlign: "center",
        fontWeight: 700,
        color: on ? "var(--success)" : "var(--text-muted)",
      }}
    >
      {on ? "✓" : "-"}
    </span>
  );
}

type Tab = "cooispi" | "tanki" | "mesin" | "employee" | "flow";

function ImportCard({
  title,
  description,
  onImport,
  isPending,
  result,
  error,
}: {
  title: string;
  description: string;
  onImport: (file: File, mode: "replace" | "append") => void;
  isPending: boolean;
  result: string;
  error: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  return (
    <div className="panel">
      <div className="panel-header">{title}</div>
      <div className="panel-body">
        <p style={{ marginTop: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>{description}</p>
        <div className="field-grid">
          <div className="field">
            <label>File CSV / Excel (.csv, .xlsx)</label>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
          </div>
          <div className="field">
            <label>Mode Import</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as "replace" | "append")}>
              <option value="replace">Ganti semua data lama</option>
              <option value="append">Tambahkan / update ke data yang ada</option>
            </select>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        {result && <p className="status-text">{result}</p>}
        <button
          className="btn"
          style={{ marginTop: 12 }}
          disabled={!file || isPending}
          onClick={() => file && onImport(file, mode)}
        >
          {isPending ? "Mengunggah..." : "Import Data"}
        </button>
      </div>
    </div>
  );
}

export default function MasterDataPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("cooispi");

  const [orderResult, setOrderResult] = useState("");
  const [orderError, setOrderError] = useState("");
  const [tankResult, setTankResult] = useState("");
  const [tankError, setTankError] = useState("");
  const [tankSearch, setTankSearch] = useState("");
  const [mesinResult, setMesinResult] = useState("");
  const [mesinError, setMesinError] = useState("");
  const [mesinSearch, setMesinSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [employeeResult, setEmployeeResult] = useState("");
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [flowResult, setFlowResult] = useState("");
  const [flowError, setFlowError] = useState("");
  const [flowSearch, setFlowSearch] = useState("");

  const lastUpdatedQuery = useQuery({
    queryKey: ["master-last-updated"],
    queryFn: () => api.get<{ success: boolean; data: LastUpdated }>("/master-data/last-updated").then((r) => r.data),
  });

  const ordersQuery = useQuery({
    queryKey: ["master-orders", orderSearch],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MasterOrderRow[] }>(`/master-data/orders?search=${encodeURIComponent(orderSearch)}`)
        .then((r) => r.data),
  });

  const tanksQuery = useQuery({
    queryKey: ["master-tanks-full", tankSearch],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MasterTankRow[] }>(`/master-data/tanks/full?search=${encodeURIComponent(tankSearch)}`)
        .then((r) => r.data),
  });

  const mesinQuery = useQuery({
    queryKey: ["master-mesin-full", mesinSearch],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MasterMesinRow[] }>(`/master-data/mesin/full?search=${encodeURIComponent(mesinSearch)}`)
        .then((r) => r.data),
  });

  const employeesQuery = useQuery({
    queryKey: ["master-employees", employeeSearch],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MasterEmployeeRow[] }>(`/master-data/employees?search=${encodeURIComponent(employeeSearch)}`)
        .then((r) => r.data),
  });

  const importOrders = useMutation({
    mutationFn: (payload: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("mode", payload.mode);
      return api.post<{ message: string }>("/master-data/orders/import", formData);
    },
    onSuccess: (res) => {
      setOrderResult(res.message);
      setOrderError("");
      queryClient.invalidateQueries({ queryKey: ["master-orders"] });
      queryClient.invalidateQueries({ queryKey: ["master-last-updated"] });
    },
    onError: (err) => {
      setOrderError(err instanceof ApiError ? err.message : "Gagal mengimpor data Order.");
      setOrderResult("");
    },
  });

  const importTanks = useMutation({
    mutationFn: (payload: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("mode", payload.mode);
      return api.post<{ message: string }>("/master-data/tanks/import", formData);
    },
    onSuccess: (res) => {
      setTankResult(res.message);
      setTankError("");
      queryClient.invalidateQueries({ queryKey: ["master-tanks-full"] });
      queryClient.invalidateQueries({ queryKey: ["master-tanks"] });
      queryClient.invalidateQueries({ queryKey: ["master-last-updated"] });
    },
    onError: (err) => {
      setTankError(err instanceof ApiError ? err.message : "Gagal mengimpor Code Tanki.");
      setTankResult("");
    },
  });

  const importMesin = useMutation({
    mutationFn: (payload: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("mode", payload.mode);
      return api.post<{ message: string }>("/master-data/mesin/import", formData);
    },
    onSuccess: (res) => {
      setMesinResult(res.message);
      setMesinError("");
      queryClient.invalidateQueries({ queryKey: ["master-mesin-full"] });
      queryClient.invalidateQueries({ queryKey: ["master-last-updated"] });
    },
    onError: (err) => {
      setMesinError(err instanceof ApiError ? err.message : "Gagal mengimpor Code Mesin.");
      setMesinResult("");
    },
  });

  const flowQuery = useQuery({
    queryKey: ["master-material-flow", flowSearch],
    queryFn: () =>
      api
        .get<{ success: boolean; data: MaterialFlowRow[] }>(`/master-data/material-flow?search=${encodeURIComponent(flowSearch)}`)
        .then((r) => r.data),
  });

  const importEmployees = useMutation({
    mutationFn: (payload: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("mode", payload.mode);
      return api.post<{ message: string }>("/master-data/employees/import", formData);
    },
    onSuccess: (res) => {
      setEmployeeResult(res.message);
      setEmployeeError("");
      queryClient.invalidateQueries({ queryKey: ["master-employees"] });
      queryClient.invalidateQueries({ queryKey: ["master-last-updated"] });
    },
    onError: (err) => {
      setEmployeeError(err instanceof ApiError ? err.message : "Gagal mengimpor data karyawan.");
      setEmployeeResult("");
    },
  });

  const importFlow = useMutation({
    mutationFn: (payload: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      formData.append("mode", payload.mode);
      return api.post<{ message: string }>("/master-data/material-flow/import", formData);
    },
    onSuccess: (res) => {
      setFlowResult(res.message);
      setFlowError("");
      queryClient.invalidateQueries({ queryKey: ["master-material-flow"] });
      queryClient.invalidateQueries({ queryKey: ["master-last-updated"] });
    },
    onError: (err) => {
      setFlowError(err instanceof ApiError ? err.message : "Gagal mengimpor Material Flow.");
      setFlowResult("");
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "cooispi" ? "" : "btn-outline"}`} onClick={() => setTab("cooispi")}>
          Master Data Cooispi
        </button>
        <button className={`btn ${tab === "tanki" ? "" : "btn-outline"}`} onClick={() => setTab("tanki")}>
          Master Data Tanki
        </button>
        <button className={`btn ${tab === "mesin" ? "" : "btn-outline"}`} onClick={() => setTab("mesin")}>
          Master Data Mesin
        </button>
        <button className={`btn ${tab === "employee" ? "" : "btn-outline"}`} onClick={() => setTab("employee")}>
          Employee Data
        </button>
        <button className={`btn ${tab === "flow" ? "" : "btn-outline"}`} onClick={() => setTab("flow")}>
          Material Flow Proses
        </button>
      </div>

      {tab === "cooispi" && (
        <>
          <ImportCard
            title="Referensi Order / PO (SAP-COOISPI)"
            description='File wajib punya kolom header "Order" (boleh juga Batch, Material Number, Material Description, Order Quantity, Plant). Dulu data ini dibaca dari Spreadsheet eksternal — sekarang cukup export dari sana ke CSV/Excel lalu upload di sini.'
            onImport={(file, mode) => importOrders.mutate({ file, mode })}
            isPending={importOrders.isPending}
            result={orderResult}
            error={orderError}
          />

          <div className="panel">
            <div className="panel-header">Data Order Saat Ini ({ordersQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
              <LastUpdatedNote value={lastUpdatedQuery.data?.cooispi} />
              <input
                placeholder="Cari nomor Order..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <DataTable
                rowKey={(r: MasterOrderRow) => r.order}
                exportFileName="master-order-cooispi"
                storageKey="master-order-cooispi"
                rows={ordersQuery.data ?? []}
                freezeFirstColumn
                columns={ORDER_COLUMNS}
              />
            </div>
          </div>
        </>
      )}

      {tab === "tanki" && (
        <>
          <ImportCard
            title="Daftar Code Tanki"
            description='File wajib punya kolom header "Code Tanki" (boleh juga TA/TB, Tank Capacity, New Number, Location / Plant, Type Tanki). File lama 1-kolom polos tetap didukung.'
            onImport={(file, mode) => importTanks.mutate({ file, mode })}
            isPending={importTanks.isPending}
            result={tankResult}
            error={tankError}
          />

          <div className="panel">
            <div className="panel-header">Code Tanki Saat Ini ({tanksQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
              <LastUpdatedNote value={lastUpdatedQuery.data?.tanki} />
              <input
                placeholder="Cari Code Tanki..."
                value={tankSearch}
                onChange={(e) => setTankSearch(e.target.value)}
                style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <DataTable
                rowKey={(r: MasterTankRow) => r.code}
                exportFileName="master-tanki"
                storageKey="master-tanki"
                rows={tanksQuery.data ?? []}
                freezeFirstColumn
                columns={[
                  { key: "code", label: "Code Tanki", render: (r) => r.code },
                  { key: "taTb", label: "TA/TB", render: (r) => r.taTb ?? "-" },
                  { key: "tankCapacity", label: "Tank Capacity", render: (r) => r.tankCapacity ?? "-" },
                  { key: "newNumber", label: "New Number", render: (r) => r.newNumber ?? "-" },
                  { key: "locationPlant", label: "Location / Plant", render: (r) => r.locationPlant ?? "-" },
                  { key: "typeTanki", label: "Type Tanki", render: (r) => r.typeTanki ?? "-" },
                ]}
              />
            </div>
          </div>
        </>
      )}

      {tab === "mesin" && (
        <>
          <ImportCard
            title="Daftar Code Mesin"
            description='File wajib punya kolom header "Code Mesin Milling" (boleh juga Lokasi). Dipakai Dashboard > Mesin Monitoring.'
            onImport={(file, mode) => importMesin.mutate({ file, mode })}
            isPending={importMesin.isPending}
            result={mesinResult}
            error={mesinError}
          />

          <div className="panel">
            <div className="panel-header">Code Mesin Saat Ini ({mesinQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
              <LastUpdatedNote value={lastUpdatedQuery.data?.mesin} />
              <input
                placeholder="Cari Code Mesin..."
                value={mesinSearch}
                onChange={(e) => setMesinSearch(e.target.value)}
                style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <DataTable
                rowKey={(r: MasterMesinRow) => r.code}
                exportFileName="master-mesin"
                storageKey="master-mesin"
                rows={mesinQuery.data ?? []}
                freezeFirstColumn
                columns={[
                  { key: "code", label: "Code Mesin", render: (r) => r.code },
                  { key: "lokasi", label: "Lokasi", render: (r) => r.lokasi ?? "-" },
                ]}
              />
            </div>
          </div>
        </>
      )}

      {tab === "employee" && (
        <>
          <ImportCard
            title="Data Karyawan"
            description='File wajib punya kolom header "Employee ID" dan "Full Name" (boleh juga Organization, Job Position, Departemen, Plant) -- format export HR standar, tinggal export CSV/Excel lalu upload di sini.'
            onImport={(file, mode) => importEmployees.mutate({ file, mode })}
            isPending={importEmployees.isPending}
            result={employeeResult}
            error={employeeError}
          />

          <div className="panel">
            <div className="panel-header">Data Karyawan Saat Ini ({employeesQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
              <LastUpdatedNote value={lastUpdatedQuery.data?.employee} />
              <input
                placeholder="Cari Employee ID atau Nama..."
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <DataTable
                rowKey={(r: MasterEmployeeRow) => r.employeeId}
                exportFileName="master-employee"
                storageKey="master-employee"
                rows={employeesQuery.data ?? []}
                freezeFirstColumn
                columns={[
                  { key: "employeeId", label: "Employee ID", render: (r) => r.employeeId },
                  { key: "fullName", label: "Full Name", render: (r) => r.fullName },
                  { key: "organization", label: "Organization", render: (r) => r.organization ?? "-" },
                  { key: "jobPosition", label: "Job Position", render: (r) => r.jobPosition ?? "-" },
                  { key: "departemen", label: "Departemen", render: (r) => r.departemen ?? "-" },
                  { key: "plant", label: "Plant", render: (r) => r.plant ?? "-" },
                ]}
              />
            </div>
          </div>
        </>
      )}

      {tab === "flow" && (
        <>
          <ImportCard
            title="Material Flow Proses"
            description='File wajib punya kolom header "Material Code" (boleh juga Material, Premix, Milling, Aftermix, Colour Matching, QC, Approval, Packing). Menentukan tahap mana yang WAJIB dilalui tiap Material -- dipakai sistem utk mengunci urutan input Proses.'
            onImport={(file, mode) => importFlow.mutate({ file, mode })}
            isPending={importFlow.isPending}
            result={flowResult}
            error={flowError}
          />

          <div className="panel">
            <div className="panel-header">Material Flow Saat Ini ({flowQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
              <LastUpdatedNote value={lastUpdatedQuery.data?.flow} />
              <input
                placeholder="Cari Material Number / Description..."
                value={flowSearch}
                onChange={(e) => setFlowSearch(e.target.value)}
                style={{ marginBottom: 12, padding: 8, width: "100%", maxWidth: 320, border: "1px solid var(--border)", borderRadius: 4 }}
              />
              <DataTable
                rowKey={(r: MaterialFlowRow) => r.materialNumber}
                exportFileName="master-material-flow"
                storageKey="master-material-flow"
                rows={flowQuery.data ?? []}
                freezeFirstColumn
                columns={[
                  { key: "materialNumber", label: "Material Number", render: (r) => r.materialNumber },
                  { key: "materialDescription", label: "Material Description", render: (r) => r.materialDescription ?? "-" },
                  { key: "premixRequired", label: "Premix", render: (r) => <FlowBadge on={r.premixRequired} />, csvValue: (r) => (r.premixRequired ? "1" : "0") },
                  { key: "millingRequired", label: "Milling", render: (r) => <FlowBadge on={r.millingRequired} />, csvValue: (r) => (r.millingRequired ? "1" : "0") },
                  { key: "aftermixRequired", label: "Aftermix", render: (r) => <FlowBadge on={r.aftermixRequired} />, csvValue: (r) => (r.aftermixRequired ? "1" : "0") },
                  {
                    key: "colourMatchingRequired",
                    label: "Colour Matching",
                    render: (r) => <FlowBadge on={r.colourMatchingRequired} />,
                    csvValue: (r) => (r.colourMatchingRequired ? "1" : "0"),
                  },
                  { key: "qcRequired", label: "QC", render: (r) => <FlowBadge on={r.qcRequired} />, csvValue: (r) => (r.qcRequired ? "1" : "0") },
                  { key: "approvalRequired", label: "Approval", render: (r) => <FlowBadge on={r.approvalRequired} />, csvValue: (r) => (r.approvalRequired ? "1" : "0") },
                  { key: "packingRequired", label: "Packing", render: (r) => <FlowBadge on={r.packingRequired} />, csvValue: (r) => (r.packingRequired ? "1" : "0") },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
