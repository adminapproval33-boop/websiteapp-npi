import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

export type ExcelColor = "orange" | "green" | "blue" | "gray";

export function ExcelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="excel-block" data-nav-scope="">
      <div className="excel-section-title">{title}</div>
      {children}
    </div>
  );
}

export function ExcelRow({ children }: { children: ReactNode }) {
  return <div className="excel-row">{children}</div>;
}

/** Header sub-bagian berwarna DI DALAM 1 ExcelBlock: "QC Input Column" /
 * "Production Input Column" / "Technical Input Column" di form Approval --
 * beda dari judul ExcelBlock sendiri (rose/brand). Warnanya SENGAJA disamakan
 * persis dgn warna tahap terkait di "Proses Bar" (Dashboard Production Order
 * Monitoring) supaya bahasa warna di seluruh app konsisten: qc = kuning QC,
 * production = hijau Packing, technical = biru Aftermix. */
export function ExcelSubHeader({ label, color }: { label: string; color: "qc" | "production" | "technical" }) {
  return <div className={`excel-subsection-title excel-subsection-${color}`}>{label}</div>;
}

export function ExcelField({
  label,
  color,
  basis,
  widthPx,
  onResizeStart,
  navKey,
  onKeyDown,
  children,
}: {
  label: string;
  color?: ExcelColor;
  basis?: number | string;
  /** Lebar tetap dalam px (override `basis`) -- dipakai bareng `onResizeStart` supaya kolom bisa di-drag lebarnya oleh user. */
  widthPx?: number;
  /** Jika diisi, tampilkan drag-handle di sisi kanan sel utk mengubah `widthPx`. */
  onResizeStart?: (e: ReactMouseEvent) => void;
  /** Key sel ini di struktur `*_COL_ROWS` halaman pemanggil (SAMA dgn key yg
   * dipakai `widthPx`/`onResizeStart` di atas) -- dipakai `onKeyDown` (lihat
   * lib/excelGridNav.ts) utk tahu sel mana yg sedang fokus saat tombol panah
   * ditekan. Wajib diisi bareng `onKeyDown` supaya navigasi panah ala Excel
   * jalan; boleh dikosongkan kalau sel ini tidak ikut navigasi panah. */
  navKey?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const style: CSSProperties | undefined = widthPx
    ? { flexBasis: widthPx, maxWidth: widthPx, minWidth: 40, flexGrow: 0, flexShrink: 0, position: "relative" }
    : basis
    ? { flexBasis: basis, maxWidth: basis, position: onResizeStart ? "relative" : undefined }
    : onResizeStart
    ? { position: "relative" }
    : undefined;

  return (
    <div className={`excel-cell${color ? ` excel-${color}` : ""}`} style={style} data-navkey={navKey} onKeyDown={onKeyDown}>
      <div className="excel-cell-label">{label}</div>
      <div className="excel-cell-body">{children}</div>
      {onResizeStart && (
        <div
          className="col-resize-handle"
          onMouseDown={onResizeStart}
          title="Drag utk ubah lebar kolom"
          style={{ position: "absolute", right: 0, top: 0, height: "100%", width: 6, cursor: "col-resize", touchAction: "none" }}
        />
      )}
    </div>
  );
}

/**
 * Sel "Member" ala Premix: daftar nama + tombol +Add/-Reduce, dibungkus
 * sebagai satu sel Excel-grid supaya konsisten dgn sel lain di baris yang
 * sama (dipakai di Premix/Aftermix/Milling/Packing).
 */
export function ExcelMemberField({
  label,
  color,
  basis,
  members,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
}: {
  label: string;
  color?: ExcelColor;
  basis?: number | string;
  members: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div
      className={`excel-member-cell${color ? ` excel-${color}` : ""}`}
      style={basis ? { flexBasis: basis, maxWidth: basis } : undefined}
    >
      <div className="excel-cell-label">{label}</div>
      <div className="excel-member-add-row">
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Nama anggota"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-outline"
          title="Tambah Member"
          aria-label="Tambah Member"
          style={{ width: 26, height: 24, padding: 0, lineHeight: 1, fontWeight: 700, flex: "0 0 auto" }}
          onClick={onAdd}
        >
          +
        </button>
      </div>
      <div className="excel-member-list">
        {members.map((m, idx) => (
          <span key={idx} className="excel-member-chip">
            {m}
            <button
              type="button"
              title="Kurangi Member"
              aria-label="Kurangi Member"
              onClick={() => onRemove(idx)}
              style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontWeight: 700 }}
            >
              −
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
