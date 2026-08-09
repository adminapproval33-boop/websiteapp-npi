import { COMPANY_LOGO_DATA_URI } from "./companyLogo";

export interface PrintPackingKeepSampelData {
  materialDescription: string;
  materialNumber: string;
  batch: string;
  codeTanki: string;
  customer: string;
  order: string;
}

function esc(v: string | undefined | null): string {
  return String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function packingInspectionBoxHtml(data: PrintPackingKeepSampelData): string {
  return `<div class="doc-code">F-DTQP-LP-020</div>
<div class="box">
<div class="header">
<img src="${COMPANY_LOGO_DATA_URI}" alt="Logo" />
<h1>LEMBAR INSPEKSI PAKING</h1>
</div>
<table><tbody>
<tr>
<td class="label">Material Description</td><td class="colon">:</td><td class="val" colspan="3">${esc(data.materialDescription)}</td>
</tr>
<tr>
<td class="label">Customer</td><td class="colon">:</td><td class="val" colspan="3">${esc(data.customer)}</td>
</tr>
<tr class="divider">
<td class="label">Code Tanki</td><td class="colon">:</td><td class="val">${esc(data.codeTanki)}</td>
<td class="label">Tanggal</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
<tr>
<td class="label">No Lot</td><td class="colon">:</td><td class="val">&nbsp;</td>
<td class="label">Filter</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
<tr>
<td class="label">Material Number Pack</td><td class="colon">:</td><td class="val">${esc(data.materialNumber)}</td>
<td class="label">Jumlah Paking</td><td class="colon">:</td><td class="val">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x&nbsp;</td>
</tr>
<tr>
<td class="label">Batch Pack</td><td class="colon">:</td><td class="val">${esc(data.batch)}</td>
<td class="label"></td><td class="colon"></td><td class="val">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x&nbsp;</td>
</tr>
<tr>
<td class="label">Order Pack</td><td class="colon">:</td><td class="val">${esc(data.order)}</td>
<td class="label">Opr Paking</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
<tr>
<td class="label">Resistivity</td><td class="colon">:</td><td class="val">&nbsp;</td>
<td class="label">S.G</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
</tbody></table>
<div class="keterangan-label">Keterangan :</div>
<div class="keterangan-box">&nbsp;</div>
</div>`;
}

function keepSampelBoxHtml(data: PrintPackingKeepSampelData): string {
  return `<div class="doc-code">F-DTQP-KS-019</div>
<div class="box">
<div class="header">
<img src="${COMPANY_LOGO_DATA_URI}" alt="Logo" />
<h1>LEMBAR KEEP SAMPEL</h1>
</div>
<table><tbody>
<tr>
<td class="label">Material Description</td><td class="colon">:</td><td class="val" colspan="3">${esc(data.materialDescription)}</td>
</tr>
<tr>
<td class="label">Customer</td><td class="colon">:</td><td class="val" colspan="3">${esc(data.customer)}</td>
</tr>
<tr class="divider">
<td class="label">Material Number Pack</td><td class="colon">:</td><td class="val">${esc(data.materialNumber)}</td>
<td class="label">No Lot</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
<tr>
<td class="label">Batch Pack</td><td class="colon">:</td><td class="val">${esc(data.batch)}</td>
<td class="label">Order Pack</td><td class="colon">:</td><td class="val">${esc(data.order)}</td>
</tr>
<tr class="divider">
<td class="label">Pembuat</td><td class="colon">:</td><td class="val">&nbsp;</td>
<td class="label">Tanggal Paking</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
<tr>
<td class="label">Code Tanki</td><td class="colon">:</td><td class="val">${esc(data.codeTanki)}</td>
<td class="label">Hasil Paking</td><td class="colon">:</td><td class="val">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x&nbsp;</td>
</tr>
<tr>
<td class="label">Jumlah</td><td class="colon">:</td><td class="val">&nbsp;</td>
<td class="label"></td><td class="colon"></td><td class="val">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x&nbsp;</td>
</tr>
<tr>
<td class="label">Opr. Paking</td><td class="colon">:</td><td class="val">&nbsp;</td>
<td class="label">Viscositas</td><td class="colon">:</td><td class="val">&nbsp;</td>
</tr>
</tbody></table>
</div>`;
}

/**
 * Cetak Lembar Inspeksi Paking (F-DTQP-LP-020) + 2x Lembar Keep Sampel
 * (F-DTQP-KS-019) sekaligus dalam 1 halaman A4, meniru persis susunan kertas
 * fisik (3 kotak dipisah garis putus-putus). Auto-shrink (pola sama dgn
 * printCheckSheet.ts) supaya selalu muat 1 lembar walau printer/browser beda.
 * Field yang datanya sudah ada di form Input Check Results (Material
 * Description/Material Number/Batch/Code Tanki/Customer/Order) otomatis
 * terisi di ketiga kotak dengan label yang sama persis dgn form itu (2026-08-07,
 * instruksi eksplisit user), sisanya dicetak kosong utk diisi tangan spt
 * kertas aslinya.
 */
export function openPackingKeepSampelPrintWindow(data: PrintPackingKeepSampelData) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lembar Inspeksi Paking & Keep Sampel</title><style>
@page{size:A4;margin:10mm;}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:0;}
.print-page{max-width:210mm;margin:0 auto;transform-origin:top left;}
.doc-code{text-align:right;font-size:10px;color:#000;margin-bottom:3px;}
.box{border:2px solid #000;}
.cut-line{border-top:1px dashed #000;margin:10px 0;}
.header{display:grid;grid-template-columns:60px 1fr;align-items:center;border-bottom:2px solid #000;padding:5px 8px;}
.header img{height:30px;width:auto;object-fit:contain;}
.header h1{text-align:center;font-size:18px;font-weight:800;letter-spacing:.4px;color:#000;margin:0;}
table{width:100%;border-collapse:collapse;}
td{padding:3px 8px;font-size:11.5px;color:#000;vertical-align:top;}
.label{width:20%;white-space:nowrap;font-weight:600;}
.colon{width:2%;}
.val{width:28%;border-bottom:1px solid #000;min-height:15px;}
tr.divider td{border-top:1px solid #000;}
.keterangan-label{font-weight:600;padding:5px 8px 2px;border-top:1px solid #000;font-size:11.5px;}
.keterangan-box{height:36px;padding:0 8px;}
</style></head><body>
<div class="print-page">
${packingInspectionBoxHtml(data)}
<div class="cut-line"></div>
${keepSampelBoxHtml(data)}
<div class="cut-line"></div>
${keepSampelBoxHtml(data)}
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
