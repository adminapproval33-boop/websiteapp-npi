import { ChangeEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";

interface MasterOrderRow {
  order: string;
  batch: string | null;
  materialNumber: string | null;
  materialDescription: string | null;
  orderQty: string | null;
  plant: string | null;
}

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
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Batch</th>
                    <th>Material Number</th>
                    <th>Material Description</th>
                    <th>Qty</th>
                    <th>Plant</th>
                  </tr>
                </thead>
                <tbody>
                  {(ordersQuery.data ?? []).map((row) => (
                    <tr key={row.order}>
                      <td>{row.order}</td>
                      <td>{row.batch}</td>
                      <td>{row.materialNumber}</td>
                      <td>{row.materialDescription}</td>
                      <td>{row.orderQty}</td>
                      <td>{row.plant}</td>
                    </tr>
                  ))}
                  {(ordersQuery.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6}>Belum ada data.</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code Tanki</th>
                    <th>TA/TB</th>
                    <th>Tank Capacity</th>
                    <th>New Number</th>
                    <th>Location / Plant</th>
                    <th>Type Tanki</th>
                  </tr>
                </thead>
                <tbody>
                  {(tanksQuery.data ?? []).map((row) => (
                    <tr key={row.code}>
                      <td>{row.code}</td>
                      <td>{row.taTb}</td>
                      <td>{row.tankCapacity}</td>
                      <td>{row.newNumber}</td>
                      <td>{row.locationPlant}</td>
                      <td>{row.typeTanki}</td>
                    </tr>
                  ))}
                  {(tanksQuery.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6}>Belum ada data.</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>Full Name</th>
                    <th>Organization</th>
                    <th>Job Position</th>
                    <th>Departemen</th>
                  </tr>
                </thead>
                <tbody>
                  {(employeesQuery.data ?? []).map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.employeeId}</td>
                      <td>{row.fullName}</td>
                      <td>{row.organization}</td>
                      <td>{row.jobPosition}</td>
                      <td>{row.departemen}</td>
                    </tr>
                  ))}
                  {(employeesQuery.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5}>Belum ada data.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
