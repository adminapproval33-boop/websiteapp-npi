import { useState } from "react";

/** Dropdown filter "Semua <label>" + opsi (2026-09-11, instruksi eksplisit
 * user: filter by SPV Colour Matching/Leader/Types of Products/Base Color).
 * Bisa pilih lebih dari 1 nilai sekaligus (2026-09-15, instruksi eksplisit
 * user, mis. Leader "Moh Soleh" DAN "Rojalih" bareng) -- nilai yg sudah
 * dipilih tampil sbg tag di bawah kotak ketik, kotak ketiknya sendiri tetap
 * bisa dipakai cari/pilih nilai berikutnya (datalist, pola sama dgn
 * TankSelect/CustomerSelect di komponen lain). */
export default function FilterSelect({
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
  const [inputValue, setInputValue] = useState("");
  const inputId = `filter-select-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const listId = `${inputId}-options`;
  const availableOptions = options.filter((o) => !values.includes(o));

  function addValue(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setInputValue("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, position: "relative" }}>
      <label htmlFor={inputId} style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)" }}>
        {label}
      </label>
      <input
        id={inputId}
        list={listId}
        className="btn btn-outline"
        value={inputValue}
        onChange={(e) => {
          const v = e.target.value;
          // Cocok persis salah satu opsi (dipilih dari datalist, atau
          // diketik pas) -- langsung jadi tag & kotak dikosongkan lagi
          // supaya siap pilih nilai berikutnya.
          if (options.includes(v)) addValue(v);
          else setInputValue(v);
        }}
        placeholder={values.length > 0 ? "+ Tambah lagi..." : `Semua ${label}`}
        autoComplete="off"
      />
      <datalist id={listId}>
        {availableOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {values.length > 0 && (
        // position: absolute (2026-09-15, instruksi eksplisit user: baris
        // toolbar jangan berantakan saat filter aktif) -- tag2 SENGAJA tidak
        // ikut dihitung tinggi oleh flex row toolbar (DataTable.tsx), supaya
        // tombol Kolom/Filter/Reset di sebelahnya tidak ikut terdorong turun
        // cuma krn 1 filter ini py banyak pilihan.
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            zIndex: 5,
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            maxWidth: 220,
            background: "var(--panel-bg, #fff)",
            padding: 2,
            borderRadius: 6,
          }}
        >
          {values.map((v) => (
            <span
              key={v}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 999,
                padding: "1px 6px 1px 8px",
                fontSize: "0.72rem",
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Hapus ${v}`}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--text-muted)" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
