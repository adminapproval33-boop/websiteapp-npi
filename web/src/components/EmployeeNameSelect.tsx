import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface EmployeeOption {
  employeeId: string;
  fullName: string;
  organization: string | null;
  jobPosition: string | null;
  departemen: string | null;
}

export function useEmployeeOptions() {
  return useQuery({
    queryKey: ["master-employees-options"],
    queryFn: () => api.get<{ success: boolean; data: EmployeeOption[] }>("/master-data/employees").then((r) => r.data),
    staleTime: 60_000,
  });
}

/**
 * True kalau `name` cocok persis (tanpa peduli besar/kecil huruf) dengan salah satu
 * Full Name di Data Karyawan. Dipakai buat validasi SPV/Leader/Member/PIC sebelum
 * disimpan -- nama yang tidak ada di Data Karyawan tidak boleh lolos.
 */
export function isKnownEmployeeName(employees: EmployeeOption[] | undefined, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true; // kosong bukan tanggung jawab validasi ini -- required/optional diatur terpisah
  if (!employees) return true; // data belum termuat -- jangan tolak duluan
  return employees.some((e) => e.fullName.trim().toLowerCase() === trimmed.toLowerCase());
}

function exactNameMatches(employees: EmployeeOption[] | undefined, name: string): EmployeeOption[] {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed || !employees) return [];
  return employees.filter((e) => e.fullName.trim().toLowerCase() === trimmed);
}

/**
 * Format kolom "Input By" di semua menu History (2026-08-06, instruksi
 * eksplisit user: NIK saja tidak cukup krn user tidak hapal NIK siapa
 * namanya) -- `inputBy` yg disimpan di semua tabel Log adalah NIK login
 * (`req.auth!.nik`), BUKAN nama. Cari nama di Data Karyawan by `employeeId`
 * (NIK), tampilkan "Nama (NIK)" spy tetap bisa cross-check NIK aslinya kalau
 * perlu. NIK yg tidak ketemu di Data Karyawan (akun lama/dihapus) fallback
 * ke NIK polos apa adanya -- jangan sampai baris histori lama malah kosong.
 */
export function formatInputBy(employees: EmployeeOption[] | undefined, nik: string | null | undefined): string {
  const trimmed = (nik ?? "").trim();
  if (!trimmed) return "-";
  const found = (employees ?? []).find((e) => e.employeeId.trim() === trimmed);
  return found ? `${found.fullName} (${trimmed})` : trimmed;
}

export interface MemberEntry {
  name: string;
  nik: string | null;
  /** Qty/Pcs hasil kerja Member INI sendiri (2026-08-10, instruksi eksplisit
   * user) -- dulu 1 Order dikerjakan rame-rame lalu Qty/Man dibagi rata per
   * kepala (tidak adil kalau hasil kerja tiap orang beda). Sekarang tiap
   * Member punya Qty/Pcs sendiri, dicatat per orang saat ditambahkan.
   * Opsional supaya modul lain (Premix/Aftermix/Milling) yg belum pakai
   * pola ini tetap kompatibel -- baris lama tanpa field ini juga aman. */
  qtyPcs?: string;
}

/**
 * Kolom Member (Json?) dulu disimpan sbg string[] polos -- sekarang jadi
 * {name, nik}[] supaya NIK anggota yg dipilih dari dropdown ikut tersimpan
 * (2026-08-08, fix bug NIK ketuker antar karyawan bernama sama). Fungsi ini
 * menormalkan kedua bentuk (baris lama string[] maupun baris baru
 * {name,nik}[]) jadi satu tipe seragam, spy baris histori lama tetap bisa
 * dibaca tanpa error.
 */
export function normalizeMembers(raw: unknown): MemberEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MemberEntry[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) out.push({ name, nik: null });
    } else if (entry && typeof entry === "object" && "name" in entry) {
      const name = String((entry as { name: unknown }).name ?? "").trim();
      if (!name) continue;
      const nikRaw = (entry as { nik?: unknown }).nik;
      const nik = typeof nikRaw === "string" && nikRaw.trim() ? nikRaw.trim() : null;
      const qtyPcsRaw = (entry as { qtyPcs?: unknown }).qtyPcs;
      const qtyPcs = typeof qtyPcsRaw === "string" && qtyPcsRaw.trim() ? qtyPcsRaw.trim() : undefined;
      out.push({ name, nik, qtyPcs });
    }
  }
  return out;
}

/**
 * Cari Employee ID (NIK) utk sebuah nama -- utamakan `nik` yg sudah
 * tersimpan (sumber pasti, hasil pilihan user dari dropdown saat disimpan).
 * Kalau baris lama belum punya `nik` tersimpan (data sebelum fix ini),
 * fallback ke pencocokan nama seperti sebelumnya (bisa ambigu kalau ada 2
 * karyawan nama sama -- itu sebabnya baris baru harus selalu bawa `nik`).
 */
export function resolveEmployeeId(
  employees: EmployeeOption[] | undefined,
  name: string | null | undefined,
  nik: string | null | undefined
): string | undefined {
  const trimmedNik = (nik ?? "").trim();
  if (trimmedNik) return trimmedNik;
  const trimmedName = (name ?? "").trim().toLowerCase();
  if (!trimmedName || !employees) return undefined;
  return employees.find((e) => e.fullName.trim().toLowerCase() === trimmedName)?.employeeId;
}

/** Format "Nama (NIK)" utk ditampilkan di History/export, pakai `resolveEmployeeId`. */
export function displayNameWithNik(
  employees: EmployeeOption[] | undefined,
  name: string | null | undefined,
  nik: string | null | undefined
): string {
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) return "";
  const id = resolveEmployeeId(employees, name, nik);
  return id ? `${trimmedName} (${id})` : trimmedName;
}

/**
 * Dropdown pencarian nama karyawan, mirip TankSelect tapi menampilkan
 * Employee ID + Job Position + Departemen di tiap baris saran -- supaya
 * user tidak bingung kalau ada 2 orang dengan nama yang sama. Pakai dropdown kustom
 * (bukan <datalist> bawaan) lewat portal ke <body> supaya tidak terpotong
 * oleh `overflow: hidden` milik .excel-block, dan bisa render info lebih
 * dari sekadar teks polos. Tetap bisa diketik bebas seperti komponen lain.
 *
 * `onChange` membawa argumen ke-2 (`employeeId`) berisi NIK karyawan yg
 * benar-benar dipilih dari dropdown -- sebelumnya cuma nama teks yg
 * dikirim balik ke parent, jadi kalau ada 2 karyawan nama sama (mis. 2
 * "Sulaeman" NIK beda) sistem tidak pernah tahu yg mana yg dipilih user
 * (2026-08-08 bug fix). Ketik manual selalu mengosongkan NIK (null) sampai
 * `onBlur` berhasil mencocokkan persis 1 nama, atau user klik saran.
 */
export default function EmployeeNameSelect({
  value,
  onChange,
  id,
  required = false,
  bare = false,
  label = "Nama",
  placeholder,
  employeeId,
}: {
  value: string;
  onChange: (value: string, employeeId?: string | null) => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
  placeholder?: string;
  /** NIK yg sedang tercatat di parent utk field ini (dari DB saat edit, atau hasil pilihan dropdown sebelumnya). */
  employeeId?: string | null;
}) {
  const { data: employees } = useEmployeeOptions();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  function updateRect() {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 2, left: r.left, width: r.width });
  }

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = employees ?? [];
    const matches = q ? list.filter((e) => e.fullName.toLowerCase().includes(q)) : list;
    return matches.slice(0, 50);
  }, [employees, value]);

  const isInvalid = !isKnownEmployeeName(employees, value);
  const exactMatches = useMemo(() => exactNameMatches(employees, value), [employees, value]);
  const isAmbiguous = exactMatches.length >= 2;

  function handleBlur() {
    // Kalau parent belum punya NIK utk field ini dan ketikan user cocok
    // persis dgn SATU karyawan, coba resolve otomatis (mis. user ketik
    // manual/paste tanpa klik saran, tapi namanya tidak kembar). Jangan
    // jalan kalau parent SUDAH punya NIK (mis. baris lama hasil edit) --
    // supaya blur ulang tidak menimpa NIK yg sudah benar dgn hasil re-cek
    // yg ambigu.
    if (employeeId) return;
    if (exactMatches.length === 1) {
      onChange(value, exactMatches[0].employeeId);
    }
  }

  const dropdown =
    open && rect && filtered.length > 0
      ? createPortal(
          <div
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              zIndex: 1000,
              maxHeight: 280,
              overflowY: "auto",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
            }}
          >
            {filtered.map((emp) => (
              <div
                key={emp.employeeId}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(emp.fullName, emp.employeeId);
                  setOpen(false);
                }}
                style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#1e293b" }}>{emp.fullName}</div>
                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                  {emp.employeeId}
                  {emp.jobPosition ? ` · ${emp.jobPosition}` : ""}
                  {emp.departemen ? ` · ${emp.departemen}` : ""}
                </div>
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  const inputEl = (
    <div ref={wrapperRef} style={{ position: "relative", flex: 1, width: "100%" }}>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        style={isInvalid ? { width: "100%", borderColor: "var(--danger)", background: "#fef2f2" } : { width: "100%" }}
        title={isInvalid ? "Nama tidak ditemukan di Data Karyawan. Pilih dari daftar saran." : undefined}
      />
      {dropdown}
      {isInvalid && (
        <div style={{ fontSize: "0.7rem", color: "var(--danger)", marginTop: 2 }}>Nama tidak ada di Data Karyawan.</div>
      )}
      {!isInvalid && isAmbiguous && !employeeId && (
        <div style={{ fontSize: "0.7rem", color: "var(--danger)", marginTop: 2 }}>
          Nama ini dipakai oleh beberapa karyawan -- pilih dari daftar saran.
        </div>
      )}
    </div>
  );

  if (bare) return inputEl;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {inputEl}
    </div>
  );
}
