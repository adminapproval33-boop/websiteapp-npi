import { ChangeEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import DataTable from "../../components/DataTable";

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

interface MasterEmployeeRow {
  employeeId: string;
  fullName: string;
  organization: string | null;
  jobPosition: string | null;
  departemen: string | null;
}

type Tab = "cooispi" | "tanki" | "employee";

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
  const [orderSearch, setOrderSearch] = useState("");
  const [employeeResult, setEmployeeResult] = useState("");
  const [employeeError, setEmployeeError] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");

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
    },
    onError: (err) => {
      setTankError(err instanceof ApiError ? err.message : "Gagal mengimpor Code Tanki.");
      setTankResult("");
    },
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
    },
    onError: (err) => {
      setEmployeeError(err instanceof ApiError ? err.message : "Gagal mengimpor data karyawan.");
      setEmployeeResult("");
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
        <button className={`btn ${tab === "employee" ? "" : "btn-outline"}`} onClick={() => setTab("employee")}>
          Employee Data
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

      {tab === "employee" && (
        <>
          <ImportCard
            title="Data Karyawan"
            description='File wajib punya kolom header "Employee ID" dan "Full Name" (boleh juga Organization, Job Position, Departemen) -- format export HR standar, tinggal export CSV/Excel lalu upload di sini.'
            onImport={(file, mode) => importEmployees.mutate({ file, mode })}
            isPending={importEmployees.isPending}
            result={employeeResult}
            error={employeeError}
          />

          <div className="panel">
            <div className="panel-header">Data Karyawan Saat Ini ({employeesQuery.data?.length ?? 0} ditampilkan)</div>
            <div className="panel-body">
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
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
