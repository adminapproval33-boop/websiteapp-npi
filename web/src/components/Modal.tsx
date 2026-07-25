import { ReactNode } from "react";

export default function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Lebar modal (px). Default 520 -- naikkan utk konten lebar seperti tabel banyak kolom. */
  width?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease]"
      onClick={onClose}
    >
      <div
        className="panel max-w-[90vw] max-h-[85vh] overflow-auto shadow-2xl"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header flex items-center justify-between">
          <span>{title}</span>
          <button className="btn btn-outline" onClick={onClose}>
            Tutup
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
