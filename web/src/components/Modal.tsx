import { ReactNode } from "react";

export default function Modal({
  title,
  onClose,
  children,
  width = 520,
  closeOnBackdropClick = true,
  onBack,
  bodyPadding,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Lebar modal (px). Default 520 -- naikkan utk konten lebar seperti tabel banyak kolom. */
  width?: number;
  /** Set false utk form input panjang (mis. modal "Input <Tahap>") supaya klik
   * tak sengaja di luar modal tidak menutup & membuang data yang sudah diisi
   * (2026-08-11, instruksi eksplisit user). Default true (perilaku lama). */
  closeOnBackdropClick?: boolean;
  /** Kalau diisi, tampilkan tombol "Kembali" di sebelah kiri "Tutup" -- utk
   * modal yang dibuka dari modal lain (mis. Input <Tahap> dari Info Proses),
   * supaya bisa mundur satu langkah tanpa menutup semuanya (2026-08-11). */
  onBack?: () => void;
  /** Override padding .panel-body (px), default 20 (dari class panel-body).
   * Dipakai utk modal isinya sudah py padding sendiri di dalamnya (mis. Info
   * Proses -> MaterialFlowPanel py panel bersarang) supaya tidak dobel jarak
   * & konten lebih muat tanpa scroll (2026-08-11, instruksi eksplisit user). */
  bodyPadding?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease]"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <div
        className="panel max-w-[90vw] max-h-[85vh] overflow-auto shadow-2xl"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header flex items-center justify-between">
          <span>{title}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {onBack && (
              <button className="btn btn-outline" onClick={onBack}>
                ← Kembali
              </button>
            )}
            <button className="btn btn-outline" onClick={onClose}>
              Tutup
            </button>
          </div>
        </div>
        <div className="panel-body" style={bodyPadding !== undefined ? { padding: bodyPadding } : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}
