import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useTankOptions() {
  return useQuery({
    queryKey: ["master-tanks"],
    queryFn: () => api.get<{ success: boolean; data: string[] }>("/master-data/tanks").then((r) => r.data),
    staleTime: 60_000,
  });
}

/** Peta Code Tanki -> "Location / Plant" (kolom "Location / Plant" di Master
 * Data » Daftar Code Tanki, mis. "IU PLANT 2") -- dipakai popup Booking Tanki
 * (2026-11-17, instruksi eksplisit user) utk otomatis isi field "IU Plant"
 * begitu Code Tanki dipilih, GANTIKAN dropdown bebas IU Plant 1-6 yg
 * sebelumnya tidak terkait tanki mana yg dipilih. Endpoint sama dgn tabel
 * Master Data Tanki (`/tanks/full`), akses GET-nya cuma requireAuth (semua
 * user login boleh baca). */
export function useTankLocationPlantMap() {
  return useQuery({
    queryKey: ["master-tanks-full"],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { code: string; locationPlant: string | null }[] }>("/master-data/tanks/full")
        .then((r) => new Map(r.data.map((t) => [t.code, t.locationPlant ?? ""]))),
    staleTime: 60_000,
  });
}

/** True kalau `value` cocok PERSIS (case-sensitive, format Master Data Tanki
 * selalu huruf besar) dengan salah satu Code Tanki di Master Data -- dipakai
 * validasi sebelum Save (2026-08-08, instruksi eksplisit user: format Code
 * Tanki wajib persis seperti di dropdown, mis. "TA08000079" yg kebetulan
 * lolos free-typing sebelumnya seharusnya "TA.04500.079"). Pola sama dgn
 * isKnownEmployeeName di EmployeeNameSelect.tsx. */
export function isKnownTankCode(tanks: string[] | undefined, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true; // kosong bukan tanggung jawab validasi ini -- required/optional diatur terpisah
  if (!tanks) return true; // data belum termuat -- jangan tolak duluan
  return tanks.includes(trimmed);
}

export default function TankSelect({
  value,
  onChange,
  id,
  required = true,
  bare = false,
  label = "Code Tanki",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const { data: tanks } = useTankOptions();
  const listId = `${id}-tank-options`;
  const isInvalid = !isKnownTankCode(tanks, value);

  const input = (
    <div style={{ flex: 1, width: "100%" }}>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        style={isInvalid ? { width: "100%", borderColor: "var(--danger)", background: "#fef2f2" } : { width: "100%" }}
        title={isInvalid ? "Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran." : undefined}
      />
      <datalist id={listId}>
        {(tanks ?? []).map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
      {isInvalid && (
        <div style={{ fontSize: "0.7rem", color: "var(--danger)", marginTop: 2 }}>
          Code Tanki tidak ada di Master Data Tanki.
        </div>
      )}
    </div>
  );

  if (bare) return input;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
}
