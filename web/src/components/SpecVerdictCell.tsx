import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isSpecFormatValid, suggestValidSpec } from "../lib/specEval";

const POPUP_WIDTH = 260;

/**
 * Badge "Valid"/"Invalid" kolom Verdict di Creating Product Spek. Kalau
 * "Invalid" DAN `onApplySuggestion` diisi (mode Input/Edit yang bisa
 * diperbaiki langsung), tampil tombol bantuan "?" -- diklik membuka popup
 * yang menyarankan format Spec pengganti (lihat lib/specEval.ts
 * suggestValidSpec), dgn tombol "Gunakan saran ini" utk langsung menimpa
 * field Spec (2026-08-09, instruksi eksplisit user). Tanpa
 * `onApplySuggestion` (dipakai di History/Detail read-only), cuma badge
 * polos tanpa tombol.
 */
export default function SpecVerdictCell({
  standardSpec,
  itemCheck,
  onApplySuggestion,
}: {
  standardSpec: string;
  itemCheck: string;
  onApplySuggestion?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Render lewat portal + position:fixed (bukan absolute) -- sel ini ada di
  // dalam `.panel` (overflow-hidden), jadi popup akan kepotong kalau cuma
  // absolute biasa (sama gotcha spt SymbolPicker.tsx). Selalu buka ke ATAS
  // tombol, posisi diukur dari tinggi asli popup lewat useLayoutEffect.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !popupRef.current) return;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const popupHeight = popupRef.current.getBoundingClientRect().height;
    setCoords({
      top: Math.max(12, buttonRect.top - popupHeight - 6),
      left: Math.min(buttonRect.left, window.innerWidth - POPUP_WIDTH - 12),
    });
  }, [open]);

  if (!standardSpec.trim()) return <span style={{ color: "var(--text-muted)" }}>-</span>;

  const valid = isSpecFormatValid(standardSpec, itemCheck);
  const badge = (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: valid ? "#dcfce7" : "#fee2e2",
        color: valid ? "#15803d" : "#b91c1c",
      }}
    >
      {valid ? "Valid" : "Invalid"}
    </span>
  );

  if (valid || !onApplySuggestion) return badge;

  const suggestion = suggestValidSpec(standardSpec, itemCheck);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {badge}
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title="Bantuan format Spec"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          background: "#fff",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
            <div
              ref={popupRef}
              className="panel"
              style={{
                position: "fixed",
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                visibility: coords ? "visible" : "hidden",
                width: POPUP_WIDTH,
                zIndex: 40,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: "0.8rem",
                textAlign: "left",
              }}
            >
              {suggestion ? (
                <>
                  <p style={{ margin: 0 }}>
                    Format Spec <strong>"{standardSpec}"</strong> belum dikenali sistem. Coba ganti jadi:
                  </p>
                  <div style={{ background: "#f1f5f9", borderRadius: 6, padding: "4px 8px", fontFamily: "monospace" }}>
                    {suggestion}
                  </div>
                  <button
                    type="button"
                    className="btn btn-success"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      onApplySuggestion(suggestion);
                      setOpen(false);
                    }}
                  >
                    Gunakan saran ini
                  </button>
                </>
              ) : (
                <p style={{ margin: 0 }}>
                  {`Format Spec "${standardSpec}" belum dikenali sistem, dan tidak ada saran otomatis. Format yang didukung: rentang ("40-45"), pembanding ("<=28", ">=10"), teks "OK", atau grade kekerasan pensil (khusus Item Check Hardness).`}
                </p>
              )}
            </div>
          </>,
          document.body
        )}
    </span>
  );
}
