import { useEffect, useRef, useState } from "react";

/** Filter multi-pilih berbentuk TOMBOL dropdown dgn daftar centang (2026-09-20,
 * instruksi eksplisit user: pengganti FilterSelect yg tag-nya melayang &
 * menimpa kartu KPI). Gayanya sama dgn tombol "☰ Status"/"☰ Lama Proses"/
 * "☰ Kolom": tombol jadi terisi + tampil jumlah pilihan kalau ada yg dipilih,
 * panel centang muncul di bawah tombol & menutup kalau klik di luar. Kosong =
 * semua nilai (tidak memfilter). */
export default function FilterCheckboxSelect({
  label,
  values,
  onChange,
  options,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((x) => x !== o) : [...values, o]);
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={`btn ${open || values.length > 0 ? "" : "btn-outline"}`}
        title={values.length > 0 ? values.join(", ") : `Semua ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ☰ {label}
        {values.length > 0 ? ` (${values.length})` : ""}
      </button>
      {open && (
        <div className="panel" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 210, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: "0.78rem" }}>
            <button
              type="button"
              onClick={() => onChange([...options])}
              style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--navy-light, #2563eb)", fontWeight: 600 }}
            >
              Pilih semua
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={values.length === 0}
              style={{ border: "none", background: "none", cursor: values.length === 0 ? "default" : "pointer", padding: 0, color: "var(--text-muted)", fontWeight: 600 }}
            >
              Hapus
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {options.length === 0 && <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Belum ada pilihan.</div>}
            {options.map((o) => (
              <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem", cursor: "pointer" }}>
                <input type="checkbox" checked={values.includes(o)} onChange={() => toggle(o)} />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
