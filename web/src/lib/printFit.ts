const MM_TO_PX = 3.7795275591;
const PAGE_HEIGHT_MM = 297;
/** Harus sama dengan margin di `@page` pada print.css. */
const PAGE_MARGIN_MM = 10;

/**
 * Perkecil elemen `.print-page` (pakai CSS `zoom`) sampai tingginya muat
 * dalam SATU halaman A4, berapa pun jumlah baris Spec Parameters-nya (mis.
 * sampai 40 parameter). Dipanggil sesaat sebelum window.print().
 */
export function fitPrintPageToOneA4(selector = ".print-page") {
  const page = document.querySelector<HTMLElement>(selector);
  if (!page) return;

  page.style.setProperty("zoom", "1");
  const maxHeightPx = (PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX;
  const actualHeight = page.scrollHeight;

  if (actualHeight > maxHeightPx) {
    const scale = Math.max(0.4, maxHeightPx / actualHeight);
    page.style.setProperty("zoom", String(scale));
  }
}
