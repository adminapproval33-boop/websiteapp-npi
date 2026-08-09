import { COMPANY_LOGO_DATA_URI } from "./companyLogo";
import { formatDateTime } from "./datetime";

export interface PrintCheckSheetParam {
  no: number;
  parameter: string;
  standard: string;
  result: string;
  start: string;
  finish: string;
  pic: string;
}

export interface PrintCheckSheetData {
  order: string;
  materialNumber: string;
  materialDescription: string;
  batch: string;
  materialNumber2: string;
  batch2: string;
  orderQty: string;
  plant: string;
  lotCoa: string;
  iuPlant: string;
  codeTanki: string;
  customer: string;
  custSegmen: string;
  remark: string;
  appearanceNotes: string;
  specInformation?: string | null;
  inputBy: string;
  parameters: PrintCheckSheetParam[];
}

function esc(v: string | undefined | null): string {
  return String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/**
 * Cetak Check Sheet langsung dari data yang SEDANG diketik di form (belum
 * tentu sudah di-Save) -- meniru perilaku printCekSheet() versi Apps Script
 * lama yang mencetak dari isi form saat itu juga, bukan dari data tersimpan
 * di server. Dipakai di tab "Input Check Results" supaya tombol Print tidak
 * perlu menunggu data disimpan dulu.
 */
export function openCheckSheetPrintWindow(data: PrintCheckSheetData) {
  const rowsHtml = data.parameters
    .map(
      (p) =>
        `<tr><td>${p.no}</td><td>${esc(p.parameter)}</td><td style="text-align:center">${esc(p.standard)}</td><td style="text-align:center">${esc(
          p.result
        )}</td><td>${esc(p.pic)}</td></tr>`
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Check Sheet - ${esc(data.order)}</title><style>
@page{size:A4;margin:10mm;}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0;}
.print-page{max-width:210mm;margin:0 auto;transform-origin:top left;}
.doc-header{display:grid;grid-template-columns:70px 1fr 130px;align-items:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;}
.doc-logo{height:34px;width:auto;object-fit:contain;}
.doc-header h1{text-align:center;font-size:17px;font-weight:800;letter-spacing:.4px;color:#000;margin:0;}
.doc-code{text-align:right;font-size:9.5px;color:#000;line-height:1.5;}
.doc-code .print-date{margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed;}
th,td{border:1px solid #000;padding:4px 7px;font-size:11px;text-align:left;word-break:break-word;overflow-wrap:break-word;color:#000;}
th{background:#fff;color:#000;font-weight:700;}
.section-title{font-weight:700;font-size:12px;color:#000;margin:12px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #000;}
.bottom-grid{display:flex;align-items:flex-start;gap:14px;margin-top:16px;}
.bottom-left{flex:1;display:flex;flex-direction:column;border-right:1px solid #000;padding-right:14px;height:2.5cm;}
.ruled-table{width:100%;border-collapse:collapse;margin:0;height:1.25cm;}
.ruled-table td{border:none;border-bottom:1px solid #000;padding:1px 2px;font-size:8.5px;color:#000;}
.ruled-title{font-weight:700;font-size:9.5px;padding-bottom:1px;}
.bottom-right{width:2.5cm;height:2.5cm;flex:0 0 2.5cm;display:flex;flex-direction:column;}
.signature-title{border:1px solid #000;font-weight:700;text-align:center;padding:2px;font-size:9px;color:#000;}
.signature-box{border:1px solid #000;border-top:none;flex:1;}
</style></head><body>
<div class="print-page">
<div class="doc-header">
<img class="doc-logo" src="${COMPANY_LOGO_DATA_URI}" alt="Logo" />
<h1>CHECK SHEET QUALITY CONTROL</h1>
<div class="doc-code">Doc No. F-D TQP-FI-011<div class="print-date">Dicetak: ${esc(formatDateTime(new Date()))}</div></div>
</div>
<table style="margin-bottom:0"><tbody>
<tr><th style="width:11%">Order Pack</th><td style="width:22%">${esc(data.order)}</td><th style="width:11%">Material Description</th><td style="width:56%">${esc(data.materialDescription)}</td></tr>
</tbody></table>
<table style="margin-bottom:0"><tbody>
<tr><th style="width:11%">Material Number Pack</th><td style="width:22%">${esc(data.materialNumber)}</td><th style="width:11%">Batch Pack</th><td style="width:22%">${esc(data.batch)}</td><th style="width:11%">Order Qty</th><td style="width:23%">${esc(data.orderQty)}</td></tr>
</tbody></table>
<table style="margin-bottom:0"><tbody>
<tr><th style="width:11%">Material Number Loose</th><td style="width:22%">${esc(data.materialNumber2)}</td><th style="width:11%">Batch Loose</th><td style="width:22%">${esc(data.batch2)}</td><th style="width:11%">Plant</th><td style="width:23%">${esc(data.plant)}</td></tr>
</tbody></table>
<table style="margin-bottom:0"><tbody>
<tr><th style="width:11%">Customer</th><td style="width:22%">${esc(data.customer)}</td><th style="width:11%">Cust Segmen</th><td style="width:22%">${esc(data.custSegmen)}</td><th style="width:11%">Lot COA</th><td style="width:23%">${esc(data.lotCoa)}</td></tr>
</tbody></table>
<table><tbody>
<tr><th style="width:11%">IU Plant</th><td style="width:22%">${esc(data.iuPlant)}</td><th style="width:11%">Code Tanki</th><td style="width:22%">${esc(data.codeTanki)}</td><th style="width:11%">Remark</th><td style="width:23%">${esc(data.remark)}</td></tr>
</tbody></table>
<div class="section-title">Spec Parameters</div>
<table><thead><tr><th style="width:6%">No</th><th style="width:40%">Item Check</th><th style="width:18%;text-align:center">Spec</th><th style="width:18%;text-align:center">Result</th><th style="width:18%">PIC</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<div class="bottom-grid">
<div class="bottom-left">
<table class="ruled-table"><tbody>
<tr><td class="ruled-title">Information</td></tr>
<tr><td>${esc(data.specInformation) || "-"}</td></tr>
<tr><td>&nbsp;</td></tr>
</tbody></table>
<table class="ruled-table"><tbody>
<tr><td class="ruled-title">Appearance Check Results</td></tr>
<tr><td>${esc(data.appearanceNotes) || "-"}</td></tr>
<tr><td>&nbsp;</td></tr>
</tbody></table>
</div>
<div class="bottom-right">
<div class="signature-title">Signature</div>
<div class="signature-box">&nbsp;</div>
</div>
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
