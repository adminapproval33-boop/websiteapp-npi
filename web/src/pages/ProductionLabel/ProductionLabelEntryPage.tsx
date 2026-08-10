import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import BarcodeSvg from "../../components/BarcodeSvg";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import { formatDateDDMMYYYY } from "../../lib/datetime";
import LabelHistoryPage from "./LabelHistoryPage";
import "../../styles/printLabel.css";

/** Paste/Kepala Warna/Assorted -- dropdown manual (2026-08-04, instruksi
 * eksplisit user), tidak ada sumber datanya di modul manapun. */
const PASTE_TYPE_OPTIONS = ["Paste", "Kepala Warna", "Assorted", "Kode PASTE Tidak Ada"];

/** Code Tanki di menu ini SATU-SATUNYA yg boleh berisi gabungan "A / B"
 * (autofill dari MillingLog.codeTanki1/2 yg beda, lihat getLatestCrossModule
 * di productionLabel.routes.ts) -- validasi tiap bagian yg dipisah " / "
 * sendiri2, bukan seluruh string sekaligus (2026-08-08). */
function isKnownTankCodeOrJoined(tanks: string[] | undefined, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed.split(" / ").every((part) => isKnownTankCode(tanks, part));
}

interface CrossModuleData {
  codeTanki: string | null;
  iuPlant: string | null;
  remark: string | null;
}

/** Production Label Entry -- cetak label produksi utk printer Honeywell
 * PC42T, ukuran sticker 100mm (lebar) x 140mm (tinggi). Order/Material
 * Number/Description/Batch/Order Qty/Plant dari Master Data Order
 * (OrderLookup, sama sumber dgn modul lain). Code Tanki/IU Plant/Remark
 * di-autofill dari input TERAKHIR across Premix/Aftermix/Milling/Approval/
 * Admin QC (GET /production-label/latest-cross-module/:order), ditampilkan
 * via TankSelect/IuPlantSelect (2026-08-04, revisi ke-12 -- dropdown sama
 * spt menu input proses lain, bukan lagi input teks bebas) tapi tetap bisa
 * dioverride manual. Lot No/Shelf Life/Drum Colour/Paste-Kepala Warna-
 * Assorted SENGAJA cuma isian manual -- tidak ada sumber otomatisnya di
 * sistem manapun. Exp (revisi ke-12) BUKAN lagi isian manual -- dihitung
 * OTOMATIS = Lot No + Shelf Life (bulan), lihat useEffect kalkulasi di
 * bawah; input Exp di form jadi disabled/read-only. Shelf Life juga
 * ditampilkan di header label (sejajar baris "NIPPON PAINT/Production
 * Label", rata kanan).
 *
 * Layout (revisi ke-7, 2026-08-04) -- niru template "shipping label": nama
 * perusahaan (tanpa logo, sudah dihapus atas instruksi user, tidak ada
 * file logo asli), garis rangkap, lalu SATU barcode CODE39 BESAR dominan
 * utk **Batch** (displayValue tampil di bawah bar), baris-baris info
 * dipisah garis horizontal tipis dgn urutan Lot No/Exp -> Material Number
 * -> Material Description -> IU Plant/Material Type -> Code Tanki ->
 * Drum Colour, lalu barcode **Order** (lebih kecil) berdampingan dgn QR
 * Code dekat bawah, ditutup baris Other(=remark). Order & Batch SENGAJA
 * ditukar posisi dari revisi sebelumnya atas instruksi user. QR Code cuma
 * berisi 4 field (Material Number/Description/Lot No/Exp -- dipersempit
 * dari 9 field supaya bisa dikecilkan & baris Other tetap kelihatan) sbg
 * teks "Label: Value" per baris -- lihat useEffect QR di bawah, regenerate
 * tiap Lot No/Exp berubah. Semua ukuran mm di CSS (printLabel.css) sudah
 * dikalibrasi & diverifikasi lewat render headless Chrome supaya pas
 * mengisi 140mm tanpa overflow/celah kosong -- HATI-HATI kalau mengubah
 * ukuran font/padding lagi, terutama field yg nilainya bisa panjang
 * (Material Number/Description) di kolom SETENGAH lebar: pernah bikin teks
 * pecah 2 baris & overflow keluar halaman, makanya sekarang full-width.
 * Klik Cetak Label -> simpan dulu sbg baris History baru (POST
 * /production-label, lihat menu Label History) baru window.print(). */
export default function ProductionLabelEntryPage() {
  const { data: tanks } = useTankOptions();
  const [tab, setTab] = useState<"input" | "history">("input");
  const [order, setOrder] = useState("");
  const [data, setData] = useState<OrderRefData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lotNo, setLotNo] = useState("");
  const [exp, setExp] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [codeTanki, setCodeTanki] = useState("");
  const [iuPlant, setIuPlant] = useState("");
  const [pasteType, setPasteType] = useState("");
  const [drumColour, setDrumColour] = useState("");
  const [remark, setRemark] = useState("");

  // QR Code (2026-08-04, revisi ke-7, instruksi eksplisit user: dipersempit
  // dari 9 field jadi cuma 4 -- Material Number/Description/Lot No/Exp --
  // supaya QR-nya bisa dikecilkan & baris Other di bawahnya tetap kelihatan
  // tanpa kepotong/overflow). Teks "Label: Value" per baris (bukan JSON)
  // spy langsung kebaca apa adanya oleh scanner umum. Tiap baris SENGAJA
  // diakhiri " |" sebelum "\n" (2026-08-04, laporan user: hasil scan Google
  // Lens numpuk jadi satu paragraf krn Lens me-reflow/collapse line-break
  // saat menampilkan teks hasil decode -- di luar kendali kita) -- dgn
  // separator " |" ini, hasilnya TETAP jelas terpisah per field walau
  // line-break-nya ke-collapse. Regenerate tiap Lot No/Exp berubah (Material
  // Number/Description ikut Order yg ditemukan).
  useEffect(() => {
    if (!data) {
      setQrDataUrl("");
      return;
    }
    const qrText = [
      `Material Number: ${data.materialNumber || "-"}`,
      `Material Description: ${data.materialDescription || "-"}`,
      `Lot No: ${formatDateDDMMYYYY(lotNo) || "-"}`,
      `Exp: ${formatDateDDMMYYYY(exp) || "-"}`,
    ].join(" |\n");
    let cancelled = false;
    // BUG FIX 2026-08-04: `margin: 0` sebelumnya menghapus TOTAL quiet zone
    // (zona kosong wajib di sekeliling QR) -- ini bikin scanner gagal
    // mendeteksi pola QR-nya sama sekali (dilaporkan user: "QR tidak bisa
    // discan"), meski secara visual polanya kelihatan valid. `margin: 2`
    // (2 modul, bukan 0 ataupun default 4 spec penuh) dipilih sbg jalan
    // tengah -- cukup utk scanner mendeteksi, tapi tidak terlalu banyak
    // makan porsi ukuran cetak yg sudah pas-pasan di label 100x140mm.
    // errorCorrectionLevel "L" dipertahankan (bukan default "M") supaya
    // modulnya tetap sedikit (~37-41 modul utk data realistis 4 field ini)
    // -- makin sedikit modul = tiap modul makin besar dicetak, makin
    // gampang discan di printer thermal 203dpi.
    toDataURL(qrText, { margin: 2, width: 300, errorCorrectionLevel: "L" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [data, lotNo, exp]);

  // Exp = Lot No + Shelf Life (2026-08-04, instruksi eksplisit user) --
  // Shelf Life dalam bulan, dihitung otomatis begitu Lot No & Shelf Life
  // keduanya terisi. Field Exp jadi read-only di form (lihat disabled di
  // JSX) krn nilainya murni turunan, bukan isian manual lagi.
  useEffect(() => {
    if (!lotNo || !shelfLife.trim()) {
      setExp("");
      return;
    }
    const months = Number(shelfLife);
    const lotDate = new Date(lotNo);
    if (!Number.isFinite(months) || Number.isNaN(lotDate.getTime())) {
      setExp("");
      return;
    }
    const expDate = new Date(lotDate);
    expDate.setMonth(expDate.getMonth() + months);
    const pad = (n: number) => String(n).padStart(2, "0");
    setExp(`${expDate.getFullYear()}-${pad(expDate.getMonth() + 1)}-${pad(expDate.getDate())}`);
  }, [lotNo, shelfLife]);

  async function handleOrderFound(found: OrderRefData) {
    setData(found);
    setError("");
    setMessage("");
    // Field manual murni (tidak ada sumber datanya) -- reset tiap kali Order baru dicari.
    setLotNo("");
    setExp("");
    setShelfLife("");
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
    if (!isKnownTankCodeOrJoined(tanks, codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return;
    }
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
        lotNo: formatDateDDMMYYYY(lotNo),
        exp: exp || "",
        shelfLife,
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
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
          Production Label Entry
        </button>
        <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "history" && <LabelHistoryPage />}

      {tab === "input" && (
        <>
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
                <label>Shelf Life (bulan)</label>
                <input
                  type="number"
                  min={0}
                  value={shelfLife}
                  onChange={(e) => setShelfLife(e.target.value)}
                  placeholder="mis. 12"
                />
              </div>
              <div className="field">
                <label>Lot No</label>
                <input type="date" value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
              </div>
              <div className="field">
                <label>Exp (Otomatis: Lot No + Shelf Life)</label>
                <input type="date" value={exp} disabled />
              </div>
              <TankSelect id="production-label-code-tanki" value={codeTanki} onChange={setCodeTanki} required={false} />
              <IuPlantSelect id="production-label-iu-plant" value={iuPlant} onChange={setIuPlant} plant={data?.plant ?? ""} required={false} />
              <div className="field">
                <label>Material Type</label>
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
                <div className="label-header">
                  <div className="label-brand">
                    <div className="label-brand-name">NIPPON PAINT</div>
                    <div className="label-brand-sub">Production Label</div>
                  </div>
                  <div className="label-header-shelf-life">
                    <p className="label-cell-label">Shelf Life</p>
                    <p className="label-cell-value">{shelfLife ? `${shelfLife} Bulan` : "-"}</p>
                  </div>
                </div>
                <hr className="label-rule-double" />

                <p className="label-order-line">
                  Batch <span className="label-order-value">{data.batch || "-"}</span>
                </p>
                <div className="label-order-barcode">
                  <BarcodeSvg value={data.batch ?? ""} />
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell">
                    <p className="label-cell-label">Lot No</p>
                    <p className="label-cell-value-critical">{formatDateDDMMYYYY(lotNo) || "-"}</p>
                  </div>
                  <div className="label-cell">
                    <p className="label-cell-label">Exp</p>
                    <p className="label-cell-value-critical">{formatDateDDMMYYYY(exp) || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell" style={{ flex: "1 1 100%" }}>
                    <p className="label-cell-label">Material Number</p>
                    <p className="label-cell-value-lg">{data.materialNumber || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell" style={{ flex: "1 1 100%" }}>
                    <p className="label-cell-label">Material Description</p>
                    <p className="label-cell-value-lg">{data.materialDescription || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell">
                    <p className="label-cell-label">IU Plant</p>
                    <p className="label-cell-value">{iuPlant || "-"}</p>
                  </div>
                  <div className="label-cell">
                    <p className="label-cell-label">Material Type</p>
                    <p className="label-cell-value">{pasteType || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell">
                    <p className="label-cell-label">Code Tanki</p>
                    <p className="label-cell-value-sm">{codeTanki || "-"}</p>
                  </div>
                  <div className="label-cell">
                    <p className="label-cell-label">Drum Colour</p>
                    <p className="label-cell-value">{drumColour || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-bottom-row">
                  <div className="label-bottom-barcode">
                    <p className="label-bottom-tag">Order {data.order}</p>
                    <BarcodeSvg value={data.order} />
                  </div>
                  <div className="label-qr">{qrDataUrl && <img src={qrDataUrl} alt={`QR ${data.order}`} />}</div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell" style={{ flex: "1 1 100%" }}>
                    <p className="label-cell-label">Other</p>
                    <p className="label-cell-value-sm">{remark || "-"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
