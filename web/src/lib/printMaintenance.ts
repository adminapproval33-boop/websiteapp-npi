import { COMPANY_LOGO_DATA_URI } from "./companyLogo";
import { formatDateTime } from "./datetime";

export interface PrintMaintenanceData {
  noDok: string | null;
  codeTanki: string;
  description: string;
  reportedBy: string;
  priority: string | null;
  technician: string | null;
  scheduledDate: string | null;
  start: string | null;
  finish: string | null;
  remark: string | null;
}

function esc(v: string | undefined | null): string {
  return String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/**
 * Cetak Form Maintenance (2026-09-22, instruksi eksplisit user) -- HANYA
 * dipanggil SETELAH Job-nya tersimpan (No Dok baru ada begitu server
 * membuatnya di POST /maintenance, lihat generateNoDok di
 * maintenance.routes.ts), beda dari Check Sheet yg boleh cetak draft belum
 * disimpan. Pola window.open + document.write sama persis dgn
 * openCheckSheetPrintWindow di printCheckSheet.ts.
 */
export function openMaintenancePrintWindow(data: PrintMaintenanceData) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Form Maintenance - ${esc(data.noDok)}</title><style>
@page{size:A4;margin:10mm;}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0;}
.print-page{max-width:210mm;margin:0 auto;transform-origin:top left;}
.doc-header{display:grid;grid-template-columns:70px 1fr 130px;align-items:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;}
.doc-logo{height:34px;width:auto;object-fit:contain;}
.doc-header h1{text-align:center;font-size:17px;font-weight:800;letter-spacing:.4px;color:#000;margin:0;}
.doc-code{text-align:right;font-size:9.5px;color:#000;line-height:1.5;}
.doc-code .print-date{margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed;}
th,td{border:1px solid #000;padding:5px 8px;font-size:11.5px;text-align:left;word-break:break-word;overflow-wrap:break-word;color:#000;}
th{background:#fff;color:#000;font-weight:700;white-space:nowrap;}
.section-title{font-weight:700;font-size:12px;color:#000;margin:12px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #000;}
.block{border:1px solid #000;padding:8px;min-height:2.2cm;margin-bottom:12px;}
.sign-grid{display:flex;gap:14px;margin-top:16px;}
.sign-box{flex:1;text-align:center;}
.sign-title{font-weight:700;font-size:10.5px;border:1px solid #000;padding:3px;background:#fff;}
.sign-space{border:1px solid #000;border-top:none;height:2.2cm;}
</style></head><body>
<div class="print-page">
<div class="doc-header">
<img class="doc-logo" src="${COMPANY_LOGO_DATA_URI}" alt="Logo" />
<h1>FORM MAINTENANCE</h1>
<div class="doc-code">No Dok: ${esc(data.noDok) || "-"}<div class="print-date">Dicetak: ${esc(formatDateTime(new Date()))}</div></div>
</div>
<table><colgroup>
<col style="width:35mm"><col style="width:55mm"><col style="width:35mm"><col style="width:55mm">
</colgroup><tbody>
<tr><th>Equipment Type</th><td>${esc(data.codeTanki)}</td><th>Prioritas</th><td>${esc(data.priority) || "-"}</td></tr>
<tr><th>Pelapor</th><td>${esc(data.reportedBy)}</td><th>Teknisi / PIC</th><td>${esc(data.technician) || "-"}</td></tr>
<tr><th>Jadwal Pengerjaan</th><td>${data.scheduledDate ? esc(formatDateTime(data.scheduledDate)) : "-"}</td><th>Tanggal Mulai</th><td>${data.start ? esc(formatDateTime(data.start)) : "-"}</td></tr>
<tr><th>Tanggal Selesai</th><td colspan="3">${data.finish ? esc(formatDateTime(data.finish)) : "-"}</td></tr>
</tbody></table>
<div class="section-title">Deskripsi Kerusakan</div>
<div class="block">${esc(data.description)}</div>
<div class="section-title">Remark</div>
<div class="block">${esc(data.remark) || "-"}</div>
<div class="sign-grid">
<div class="sign-box"><div class="sign-title">Pelapor</div><div class="sign-space"></div></div>
<div class="sign-box"><div class="sign-title">Teknisi / PIC</div><div class="sign-space"></div></div>
<div class="sign-box"><div class="sign-title">Mengetahui</div><div class="sign-space"></div></div>
</div>
</div>
<script>
window.onload = function () {
  setTimeout(function () {
    var page = document.querySelector('.print-page');
    if (page) {
      var MM_TO_PX = 3.7795275591, PAGE_MARGIN_MM = 10, maxH = (297 - PAGE_MARGIN_MM * 2) * MM_TO_PX;
      page.style.zoom = 1;
      var actualH = page.scrollHeight;
      if (actualH > maxH) {
        page.style.zoom = String(Math.max(0.4, maxH / actualH));
      }
    }
    window.print();
  }, 300);
};
</script>
</body></html>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup diblokir browser. Izinkan popup untuk situs ini supaya bisa mencetak.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
