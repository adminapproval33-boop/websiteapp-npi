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

/**
 * Dropdown pencarian nama karyawan, mirip TankSelect tapi menampilkan
 * Employee ID + Job Position + Departemen di tiap baris saran -- supaya
 * user tidak bingung kalau ada 2 orang dengan nama yang sama. Pakai dropdown kustom
 * (bukan <datalist> bawaan) lewat portal ke <body> supaya tidak terpotong
 * oleh `overflow: hidden` milik .excel-block, dan bisa render info lebih
 * dari sekadar teks polos. Tetap bisa diketik bebas seperti komponen lain.
 */
export default function EmployeeNameSelect({
  value,
  onChange,
  id,
  required = false,
  bare = false,
  label = "Nama",
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
  placeholder?: string;
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
                  onChange(emp.fullName);
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
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        style={isInvalid ? { borderColor: "var(--danger)", background: "#fef2f2" } : undefined}
        title={isInvalid ? "Nama tidak ditemukan di Data Karyawan. Pilih dari daftar saran." : undefined}
      />
      {dropdown}
      {isInvalid && (
        <div style={{ fontSize: "0.7rem", color: "var(--danger)", marginTop: 2 }}>Nama tidak ada di Data Karyawan.</div>
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
