import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Barcode Code 3-of-9 (CODE39) -- dipakai di Production Label utk Order &
 * Batch (2026-08-04, instruksi eksplisit user). CODE39 cuma dukung
 * uppercase alfanumerik + sedikit simbol (spasi - . $ / + %), jadi value
 * di-uppercase dulu. Render langsung ke elemen <svg> lewat ref (jsbarcode
 * memanipulasi DOM svg-nya sendiri, bukan lewat JSX children React).
 * `displayValue` default true (angka tampil di bawah barcode), tapi
 * di-set false di layout label produksi (revisi 2026-08-04, ke-4) krn
 * angkanya sudah ditampilkan inline di sebelah label "Order"/"Batch". */
export default function BarcodeSvg({
  value,
  className,
  displayValue = true,
}: {
  value: string;
  className?: string;
  displayValue?: boolean;
}) {
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
        displayValue,
        fontSize: 12,
        height: 26,
        margin: 0,
      });
    } catch (err) {
      console.error(`BarcodeSvg: gagal render CODE39 utk "${value}"`, err);
      svg.innerHTML = "";
    }
  }, [value, displayValue]);

  return <svg ref={ref} className={className} />;
}
