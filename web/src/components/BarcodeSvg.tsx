import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Barcode Code 3-of-9 (CODE39) -- dipakai di Production Label utk Order &
 * Batch (2026-08-04, instruksi eksplisit user). CODE39 cuma dukung
 * uppercase alfanumerik + sedikit simbol (spasi - . $ / + %), jadi value
 * di-uppercase dulu. Render langsung ke elemen <svg> lewat ref (jsbarcode
 * memanipulasi DOM svg-nya sendiri, bukan lewat JSX children React). */
export default function BarcodeSvg({ value, className }: { value: string; className?: string }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    if (!value.trim()) {
      svg.innerHTML = "";
      return;
    }
    try {
      JsBarcode(svg, value.trim().toUpperCase(), {
        format: "CODE39",
        displayValue: true,
        fontSize: 12,
        height: 26,
        margin: 0,
      });
    } catch (err) {
      console.error(`BarcodeSvg: gagal render CODE39 utk "${value}"`, err);
      svg.innerHTML = "";
    }
  }, [value]);

  return <svg ref={ref} className={className} />;
}
