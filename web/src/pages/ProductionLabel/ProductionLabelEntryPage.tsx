import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import BarcodeSvg from "../../components/BarcodeSvg";
import "../../styles/printLabel.css";

/** Paste/Kepala Warna/Assorted -- dropdown manual (2026-08-04, instruksi
 * eksplisit user), tidak ada sumber datanya di modul manapun. */
const PASTE_TYPE_OPTIONS = ["Paste", "Kepala Warna", "Assorted"];

interface CrossModuleData {
  codeTanki: string | null;
  iuPlant: string | null;
  remark: string | null;
}

/** Production Label Entry (2026-08-04, instruksi eksplisit user) -- cetak
 * label produksi utk printer Honeywell PC42T, ukuran sticker 100mm (lebar) x
 * 140mm (tinggi) -- dikoreksi 2026-08-04, sebelumnya kebalik (140x100).
 * Order/Material Number/Description/Batch/Order Qty/Plant
 * dari Master Data Order (OrderLookup, sama sumber dgn modul lain). Code
 * Tanki/IU Plant/Remark di-autofill dari input TERAKHIR across Premix/
 * Aftermix/Milling/Approval/Admin QC (GET /production-label/latest-cross-
 * module/:order) tapi tetap field biasa yg bisa dioverride manual. Lot No/
 * Exp/Drum Colour/Paste-Kepala Warna-Assorted SENGAJA cuma isian manual --
 * tidak ada sumber otomatisnya di sistem manapun. Layout niru contoh label
 * fisik yg dikirim user (2026-08-04, revisi ke-2): No PO + barcode CODE39,
 * Batch No + barcode CODE39, lalu tabel bordered Mat Code/Nama Produk/Lot
 * No/Exp/Plant(=iuPlant)/No Tanki/KW-PST/Warna Drum/Other(=remark). QR Code
 * di pojok kanan atas berisi 9 field (Order/Batch/Material Number/
 * Description/Lot No/Exp/IU Plant/Code Tanki/Material Type) sbg teks
 * multi-baris "Label: Value" -- lihat useEffect QR di bawah, regenerate
 * tiap salah satu field itu berubah. Klik Cetak Label -> simpan dulu sbg
 * baris History baru (POST /production-label, lihat menu Label History)
 * baru window.print(). */
export default function ProductionLabelEntryPage() {
  const [order, setOrder] = useState("");
  const [data, setData] = useState<OrderRefData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lotNo, setLotNo] = useState("");
  const [exp, setExp] = useState("");
  const [codeTanki, setCodeTanki] = useState("");
  const [iuPlant, setIuPlant] = useState("");
  const [pasteType, setPasteType] = useState("");
  const [drumColour, setDrumColour] = useState("");
  const [remark, setRemark] = useState("");

  // QR Code berisi semua field ini (2026-08-04, instruksi eksplisit user,
  // revisi dari versi awal yg cuma berisi nomor Order) -- teks "Label: Value"
  // per baris spy langsung kebaca apa adanya oleh scanner umum, bukan JSON.
  // Tiap baris SENGAJA diakhiri " |" sebelum "\n" (2026-08-04, revisi ke-2,
  // laporan user: hasil scan Google Lens numpuk jadi satu paragraf krn Lens
  // me-reflow/collapse line-break saat menampilkan teks hasil decode -- ini
  // di luar kendali kita, bukan bug di encoding QR-nya) -- dgn separator " |"
  // ini, hasilnya TETAP jelas terpisah per field walau line-break-nya
  // ke-collapse jadi satu baris ("Order: X | Batch: Y | ..."), sekaligus
  // masih tampil sbg baris terpisah apa adanya di app yg respect "\n".
  // Regenerate tiap salah satu field-nya berubah (termasuk field manual yg
  // diketik operator setelah Order ditemukan), bukan cuma sekali di awal.
  useEffect(() => {
    if (!data) {
      setQrDataUrl("");
      return;
    }
    const qrText = [
      `Order: ${data.order}`,
      `Batch: ${data.batch || "-"}`,
      `Material Number: ${data.materialNumber || "-"}`,
      `Material Description: ${data.materialDescription || "-"}`,
      `Lot No: ${lotNo || "-"}`,
      `Exp: ${exp || "-"}`,
      `IU Plant: ${iuPlant || "-"}`,
      `Code Tanki: ${codeTanki || "-"}`,
      `Material Type: ${pasteType || "-"}`,
    ].join(" |\n");
    let cancelled = false;
    // errorCorrectionLevel "L" (bukan default "M") -- data 9 field ini cukup
    // panjang (~250 char), "L" menghasilkan modul lebih sedikit (~53 vs ~61)
    // supaya tiap modul tetap cukup besar dicetak di label 100mm, tanpa
    // korbankan resolusi sumbernya (width dinaikkan ke 400px).
    toDataURL(qrText, { margin: 0, width: 400, errorCorrectionLevel: "L" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [data, lotNo, exp, iuPlant, codeTanki, pasteType]);

  async function handleOrderFound(found: OrderRefData) {
    setData(found);
    setError("");
    setMessage("");
    // Field manual murni (tidak ada sumber datanya) -- reset tiap kali Order baru dicari.
    setLotNo("");
    setExp("");
    setPasteType("");
    setDrumColour("");
    setCodeTanki("");
    setIuPlant("");
    setRemark("");

    try {
      const res = await api.get<{ success: boolean; data: CrossModuleData }>(
        `/production-label/latest-cross-module/${encodeURIComponent(found.order)}`
      );
      setCodeTanki(res.data.codeTanki ?? "");
      setIuPlant(res.data.iuPlant ?? "");
      setRemark(res.data.remark ?? "");
    } catch {
      /* biarkan kosong -- operator isi manual */
    }
  }

  async function handlePrint() {
    if (!data) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post("/production-label", {
        order: data.order,
        materialNumber: data.materialNumber ?? "",
        materialDescription: data.materialDescription ?? "",
        batch: data.batch ?? "",
        orderQty: data.orderQty ?? "",
        plant: data.plant ?? "",
        lotNo,
        exp: exp || "",
        codeTanki,
        iuPlant,
        pasteType,
        drumColour,
        remark,
      });
      setMessage("Label tersimpan ke History.");
      setTimeout(() => window.print(), 200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan/mencetak label.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel label-form-panel">
        <div className="panel-header">Production Label Entry</div>
        <div className="panel-body">
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Cetak label produksi untuk printer Honeywell PC42T (ukuran sticker 100mm x 140mm). Cari nomor Order,
            lengkapi field manual di bawah, lalu klik Cetak Label.
          </p>
          <OrderLookup value={order} onChange={setOrder} onFound={handleOrderFound} />

          {data && (
            <div className="field-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Lot No</label>
                <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="Nomor Lot" />
              </div>
              <div className="field">
                <label>Exp</label>
                <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
              </div>
              <div className="field">
                <label>Code Tanki</label>
                <input value={codeTanki} onChange={(e) => setCodeTanki(e.target.value)} placeholder="Auto dari input terakhir, bisa diedit" />
              </div>
              <div className="field">
                <label>IU Plant</label>
                <input value={iuPlant} onChange={(e) => setIuPlant(e.target.value)} placeholder="Auto dari input terakhir, bisa diedit" />
              </div>
              <div className="field">
                <label>Material Type (Paste/Kepala Warna/Assorted)</label>
                <select value={pasteType} onChange={(e) => setPasteType(e.target.value)}>
                  <option value="">-- Pilih --</option>
                  {PASTE_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Drum Colour</label>
                <input value={drumColour} onChange={(e) => setDrumColour(e.target.value)} placeholder="Warna drum" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Remark</label>
                <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
          {message && <p className="status-text">{message}</p>}
        </div>
      </div>

      {data && (
        <div className="panel label-print-panel">
          <div className="panel-header label-form-panel">Preview Label — Order {data.order}</div>
          <div className="panel-body">
            <div className="label-toolbar">
              <button className="btn" type="button" disabled={saving} onClick={handlePrint}>
                {saving ? "Menyimpan..." : "🖨️ Cetak Label"}
              </button>
            </div>
            <div className="label-preview-wrap">
              <div className="label-page">
                <div className="label-qr-row">
                  <div className="label-qr">{qrDataUrl && <img src={qrDataUrl} alt={`QR ${data.order}`} />}</div>
                </div>

                <div className="label-barcode-group">
                  <p className="label-barcode-title">Order</p>
                  <div className="label-barcode-full">
                    <BarcodeSvg value={data.order} />
                  </div>
                </div>

                <div className="label-barcode-group">
                  <p className="label-barcode-title">Batch</p>
                  <div className="label-barcode-full">
                    <BarcodeSvg value={data.batch ?? ""} />
                  </div>
                </div>

                <table className="label-table">
                  <tbody>
                    <tr>
                      <td>Material Number</td>
                      <td>{data.materialNumber || "-"}</td>
                    </tr>
                    <tr>
                      <td>Material Description</td>
                      <td>{data.materialDescription || "-"}</td>
                    </tr>
                    <tr>
                      <td>Lot No</td>
                      <td>{lotNo || "-"}</td>
                    </tr>
                    <tr>
                      <td>Exp</td>
                      <td>{exp || "-"}</td>
                    </tr>
                    <tr>
                      <td>IU Plant</td>
                      <td>{iuPlant || "-"}</td>
                    </tr>
                    <tr>
                      <td>Code Tanki</td>
                      <td>{codeTanki || "-"}</td>
                    </tr>
                    <tr>
                      <td>Material Type</td>
                      <td>{pasteType || "-"}</td>
                    </tr>
                    <tr>
                      <td>Drum Colour</td>
                      <td>{drumColour || "-"}</td>
                    </tr>
                    <tr>
                      <td>Other</td>
                      <td>{remark || "-"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
