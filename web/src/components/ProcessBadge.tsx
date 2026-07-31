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
