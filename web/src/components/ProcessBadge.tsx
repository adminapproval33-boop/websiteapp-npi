/**
 * Warna badge "Proses" -- SENGAJA disamakan persis dgn palet warna yang sudah
 * dipakai di Dashboard Production Order Monitoring (Premix/Milling/Aftermix/
 * Colour Matching/QC/Approval/Packing), supaya bahasa warna proses konsisten
 * di seluruh app. Dipakai di Dashboard Tank Monitoring.
 */
export const STAGE_COLORS: Record<string, { bg: string; fg: string }> = {
  Queue: { bg: "#C0C0C0", fg: "#000000" },
  Premix: { bg: "#00FFFF", fg: "#000000" },
  Milling: { bg: "#008080", fg: "#ffffff" },
  Aftermix: { bg: "#0000FF", fg: "#ffffff" },
  "Colour Matching": { bg: "#000080", fg: "#ffffff" },
  QC: { bg: "#FFFF00", fg: "#000000" },
  Approval: { bg: "#808000", fg: "#ffffff" },
  Packing: { bg: "#00FF00", fg: "#000000" },
  Done: { bg: "#008000", fg: "#ffffff" },
  /** %GR=9999% (sentinel TECO SAP) utk Order yg pernah jalan -- badge merah,
   * beda dari "Done" (hijau tua), sesuai instruksi eksplisit user (2026-07-31). */
  Teco: { bg: "#FF0000", fg: "#ffffff" },
};

/** Label Proses Approval (lihat finishBasedLabel di dashboard.routes.ts,
 * direvisi TOTAL 2026-07-29 -- cuma 3 state, tidak ada lagi yg diawali "QC")
 * -- tetap dikecualikan dari deteksi isQc di bawah supaya aman kalau ada
 * label mirip di masa depan. */
const APPROVAL_STAGE_LABELS = new Set(["QU - Approval", "Approval", "Approval - DN"]);

/** Label Proses formatnya bervariasi (mis. "QC : Visco : Pass", "Milling
 * (Couple)") -- dicocokkan ke salah satu warna di STAGE_COLORS lewat
 * prefix/substring, bukan exact match. */
/** Urutan dropdown filter kolom "Proses" (2026-11-12, instruksi eksplisit
 * user: "urutkan berdasarkan proses pertama sampai yang terakhir", lalu
 * diminta disamakan juga ke Dashboard Tank Monitoring) -- ditaruh di sini
 * (bukan di 1 halaman) krn dipakai BARENG oleh Production Order Monitoring
 * & Tank Monitoring, sama alasannya dgn STAGE_COLORS di atas. "-" (belum
 * tersentuh sama sekali) dulu, lalu tiap tahap kerja urut Bongkaran ->
 * Premix -> Milling -> Aftermix -> Colour Matching -> QC -> Approval ->
 * Packing (sama urutan dipakai endpoint "/production-orders/:order/remarks"
 * di backend), dgn sub-state tiap tahap Queue -> In Progress -> Done.
 * Bongkaran ditaruh paling awal krn secara fisik terjadi SEBELUM Premix
 * (bongkar bahan baku), walau tidak ikut STAGE_SEQUENCE/Proses Bar. Nilai
 * yg kebetulan muncul tapi tidak ada di daftar ini (label baru yg belum
 * diantisipasi) otomatis diselipkan di akhir, lihat `DataTable`'s
 * `filterOptions` array handling -- jadi daftar ini TIDAK perlu 100%
 * lengkap, cuma menentukan urutannya. */
export const PROCESS_FILTER_ORDER = [
  "-",
  "Bongkaran",
  "QU - Bongkaran",
  "Produksi - PQE",
  "QU - Premix",
  "Premix",
  "Premix - DN",
  "QU - Milling",
  "Milling",
  "Milling - DN",
  "QU - Aftermix",
  "Aftermix",
  "Aftermix - DN",
  "QU - Colour Matching",
  "Colour Matching",
  "Colour Matching - DN",
  "QU - QC",
  "QC",
  "QC - DN",
  "QU - Approval",
  "Wait Approval",
  "Approval",
  "Approval - DN",
  "QU - Packing",
  "Packing",
  "Packing - DN",
];

export function getProcessColor(process: string): { bg: string; fg: string } {
  if (APPROVAL_STAGE_LABELS.has(process)) return STAGE_COLORS.Approval;
  if (process.startsWith("QC")) return STAGE_COLORS.QC;
  if (process.includes("Colour Matching")) return STAGE_COLORS["Colour Matching"];
  if (process.startsWith("Milling")) return STAGE_COLORS.Milling;
  return STAGE_COLORS[process] ?? { bg: "#e2e8f0", fg: "#1e293b" };
}

export default function ProcessBadge({ process, onClick }: { process: string; onClick?: () => void }) {
  const isQc = process.startsWith("QC") && !APPROVAL_STAGE_LABELS.has(process);
  const colors = getProcessColor(process);
  return (
    <span
      onClick={isQc ? onClick : undefined}
      title={isQc ? "Klik utk lihat detail Item Check, Start, Finish, Verdict" : undefined}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: colors.bg,
        color: colors.fg,
        cursor: isQc ? "pointer" : "default",
        textDecoration: isQc ? "underline" : "none",
      }}
    >
      {process}
    </span>
  );
}
