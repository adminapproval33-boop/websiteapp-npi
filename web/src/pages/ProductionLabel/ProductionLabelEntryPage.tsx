import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { api, ApiError } from "../../api/client";
import OrderLookup, { OrderRefData } from "../../components/OrderLookup";
import BarcodeSvg from "../../components/BarcodeSvg";
import TankSelect, { isKnownTankCode, useTankOptions } from "../../components/TankSelect";
import IuPlantSelect from "../../components/IuPlantSelect";
import { formatDateDDMMYYYY, toDateTimeLocalValue, validateNotFutureDate } from "../../lib/datetime";
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

/** Ambil angka pertama yg ketemu di isian Volume (2026-11-04, instruksi
 * eksplisit user: kolom "Qty Pack" dihapus, logic-nya PINDAH ke kolom Volume
 * yg sudah ada -- field ini isian bebas spt "1x5 Ltr", jadi ambil angka
 * PERTAMA yg muncul, bukan parse seluruh string sbg angka). */
function parseLeadingNumber(value: string): number | null {
  const match = value.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** "Kode gabungan" QR Code Yamaha, preview client-side (2026-11-04, KHUSUS
 * `showYamahaQr`) -- SAMA PERSIS formula server (`buildYamahaCodeYm` di
 * productionLabelHelpers.ts): TEXT(Lot,"DDMMYYYY") & TEXT(angka dari
 * Volume,"000") & Item No. Yamaha. Cuma dipakai utk preview QR real-time di
 * layar -- nilai yg BENERAN tersimpan ke History tetap dihitung ulang
 * server-side saat Save, supaya tidak bisa dipalsukan lewat panggilan API
 * langsung. */
function buildYamahaCodeYmPreview(lotNo: string, volume: string, itemNoYamaha: string): string {
  const lot = new Date(lotNo);
  const qty = parseLeadingNumber(volume);
  if (Number.isNaN(lot.getTime()) || qty === null || !itemNoYamaha) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const ddmmyyyy = `${pad(lot.getDate())}${pad(lot.getMonth() + 1)}${lot.getFullYear()}`;
  const qtyPadded = String(Math.round(qty)).padStart(3, "0");
  return `${ddmmyyyy}${qtyPadded}${itemNoYamaha}`;
}

interface CrossModuleData {
  codeTanki: string | null;
  iuPlant: string | null;
  remark: string | null;
}

/** Baris Admin QC TERAKHIR utk 1 Order (dari GET /admin-qc/latest-by-order/:order)
 * -- dipakai KHUSUS utk autofill "Lot No"/"Lot Passed" (lihat prop
 * `autofillLotFromAdminQc`), cuma ambil field yg dipakai. */
interface AdminQcLatestRow {
  lotPassed: string | null;
}

/** 1 tanki (baris MillingLog) milik Order yg lagi dicari -- dipakai dropdown
 * "Pilih Tanki" (2026-08-25, instruksi eksplisit user: bisa cetak label tanki
 * 1/2/3/dst, bukan cuma tanki TERAKHIR yg diinput) KHUSUS Label Entry SFG
 * (GET /production-label/milling-tanks/:order, lihat komentar di
 * productionLabel.routes.ts) -- Label Entry FG tidak relevan krn field Code
 * Tanki/IU Plant memang disembunyikan total dari form FG. */
interface MillingTankOption {
  id: number;
  label: string;
  codeTanki: string | null;
  iuPlant: string | null;
  remark: string | null;
}

/** Hasil lookup `${apiBase}/lookup-part/:materialNumber` ke MasterPartYamaha
 * (2026-11-04, KHUSUS `showYamahaQr` -- menu "QR Code Yamaha" digabung ke
 * Label Entry FG) -- null kalau Material-nya bukan Yamaha. */
interface PartYamaha {
  itemNoYamaha: string;
  itemName: string;
}

/** Kolom manual yg bisa disembunyikan per varian lewat prop `hiddenFields` -- lihat komentar propnya. */
type ProductionLabelField = "materialType" | "drumColour" | "codeTanki" | "iuPlant";

/** Kolom TAMBAHAN (opt-in, tidak tampil default) yg bisa dinyalakan per
 * varian lewat prop `extraFields` -- kebalikan dari `hiddenFields`. Dibuat
 * KHUSUS utk Label Entry FG (2026-08-20, instruksi eksplisit user), krn FG
 * sudah tidak punya panel Preview Label lagi (showPreview=false) yg dulu
 * satu-satunya tempat Material Number/Description/Batch kelihatan. */
type ProductionLabelExtraField =
  | "materialNumber"
  | "materialDescription"
  | "batch"
  | "volume"
  | "jumlahPer"
  | "orderQtyLiter"
  | "orderQtyPcs"
  | "plant"
  | "itemNoYamaha"
  | "viskositas"
  | "sg";

/** Snapshot field manual yg dibandingkan utk `skipSaveIfUnchanged` (2026-11-04,
 * instruksi eksplisit user) -- persis field2 yg dikirim ke History selain
 * yg murni read-only dari Order Lookup (Material Number/Description/
 * Quantity/Plant/Batch, di luar kendali operator, tidak relevan utk
 * mendeteksi "operator mengubah sesuatu atau tidak"). */
interface FieldSnapshot {
  lotNo: string;
  shelfLife: string;
  pasteType: string;
  drumColour: string;
  volume: string;
  jumlahPer: string;
  viskositas: string;
  sg: string;
  codeTanki: string;
  iuPlant: string;
  remark: string;
}

/** Baris History Production Label TERAKHIR utk 1 Order (dari GET
 * /production-label/latest-by-order/:order) -- dipakai utk autofill semua
 * kolom manual (2026-08-20, instruksi eksplisit user) begitu Order yg SUDAH
 * PERNAH masuk History dicari lagi, supaya tidak perlu isi ulang dari nol. */
interface ProductionLabelHistoryRow {
  lotNo: string | null;
  shelfLife: string | null;
  codeTanki: string | null;
  iuPlant: string | null;
  pasteType: string | null;
  drumColour: string | null;
  /// Cuma ada di ProductionLabelFg (kolom baru KHUSUS FG) -- undefined saat apiBase SFG, aman krn dibaca via `?? "" `.
  volume?: string | null;
  /// Cuma ada di ProductionLabelFg (kolom baru KHUSUS FG) -- undefined saat apiBase SFG, aman krn dibaca via `?? "" `.
  jumlahPer?: string | null;
  remark: string | null;
  /// Cuma ada di ProductionLabelFg (kolom baru KHUSUS FG, field QR Code Yamaha) -- undefined saat apiBase SFG, aman krn dibaca via `?? "" `.
  viskositas?: string | null;
  sg?: string | null;
}

/** Lot No disimpan di DB sbg string "dd-mm-yyyy" (lihat `formatDateDDMMYYYY`
 * saat Save), tapi input Lot No di form ini `<input type="date">` yg butuh
 * format "yyyy-mm-dd" -- kebalikan dari `formatDateDDMMYYYY`, khusus dipakai
 * utk autofill dari History (tidak ada arah ini di lib/datetime.ts krn cuma
 * dipakai di sini). */
function parseDDMMYYYYToInputDate(value: string | null | undefined): string {
  const match = (value ?? "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return "";
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

/** Label Entry SFG (menu, 2026-08-20 -- sebelumnya "Production Label Entry")
 * -- cetak label produksi utk printer Honeywell
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
 * /production-label, lihat menu Label History) baru window.print(). Tombol
 * Save (2026-08-20, instruksi eksplisit user) melakukan POST yg SAMA tapi
 * TANPA print, supaya jelas kapan data "resmi" masuk History tanpa harus
 * mencetak fisik. Order yg SUDAH PERNAH masuk History Production Label ini
 * sendiri otomatis men-autofill semua kolom manual dari baris terakhirnya
 * (lihat handleOrderFound). */
export default function ProductionLabelEntryPage({
  embedded = false,
  initialOrder,
  apiBase = "/production-label",
  title = "Label Entry SFG",
  showPrintButton = true,
  showPreview = true,
  hiddenFields = [],
  extraFields = [],
  lotNoLabel = "Lot No",
  autofillLotFromAdminQc = false,
  autofillShelfLifeFromMaterial = false,
  autofillShelfLifeFromMaterialAndType = true,
  showBatchSearch = false,
  showYamahaQr = false,
  resetFormAfterSave = false,
  skipSaveIfUnchanged = false,
}: {
  /** Mode ringkas dipakai pop-up "Info Proses Material" -> baris "Production
   * Label" setelah Packing (2026-08-11, instruksi eksplisit user: admin tidak
   * perlu bolak-balik ke menu Production Label terpisah utk cetak) -- sama
   * pola dgn embedded+initialOrder di PremixAftermixPage/MillingPage/dst.
   * Sembunyikan tab switcher Entry/History, auto-cari Order dari initialOrder. */
  embedded?: boolean;
  initialOrder?: string;
  /** Prefix API (2026-08-20, instruksi eksplisit user: menu "Label Entry FG"
   * -- tampilan/logika SAMA PERSIS dgn Label Entry SFG, tapi History-nya
   * TERPISAH TOTAL, bukan 1 tabel dibedakan kolom tipe) -- default ke SFG
   * ("/production-label"), FG pakai "/production-label-fg" lewat
   * ProductionLabelEntryFgPage.tsx. */
  apiBase?: string;
  /** Judul panel & tombol tab -- default "Label Entry SFG", FG override ke "Label Entry FG". */
  title?: string;
  /** Tombol "Cetak Label" (2026-08-20, instruksi eksplisit user: Label Entry
   * FG cuma perlu Save, TANPA cetak) -- default true (SFG tetap tampilkan
   * keduanya spt sebelumnya), FG set false lewat ProductionLabelEntryFgPage.tsx. */
  showPrintButton?: boolean;
  /** Panel "Preview Label" (mockup barcode/QR/layout label fisik, 2026-08-20
   * instruksi eksplisit user: Label Entry FG tidak perlu ini krn tidak ada
   * cetak fisik) -- default true (SFG tetap tampilkan spt sebelumnya), FG
   * set false. Tombol Save TETAP tampil terlepas dari ini (lihat JSX --
   * toolbar-nya di luar gerbang `showPreview`). */
  showPreview?: boolean;
  /** Kolom manual yg TIDAK relevan utk suatu varian (2026-08-20, instruksi
   * eksplisit user: Label Entry FG makin lama makin banyak field yg diminta
   * dihilangkan -- Material Type, Drum Colour, lalu Code Tanki/IU Plant --
   * jadi dikonsolidasi jadi 1 daftar drpd nambah prop `showX` baru tiap kali
   * diminta lagi) -- default `[]` (SFG tetap tampilkan semua field spt
   * sebelumnya), FG isi lewat ProductionLabelEntryFgPage.tsx. */
  hiddenFields?: ProductionLabelField[];
  /** Kolom TAMBAHAN (2026-08-20, instruksi eksplisit user) yg TIDAK tampil
   * default -- Material Number/Description/Batch (read-only, cuma
   * display) & Volume (editable, auto-saran dari kolom "Volume" di
   * Referensi Order/PO SAP-COOISPI sama pola dgn Packing, DAN tersimpan
   * permanen ke History -- KHUSUS kolom DB `volume` ini cuma ada di
   * ProductionLabelFg, lihat schema.prisma). Default `[]` (SFG tidak
   * berubah, field2 ini sudah kelihatan di panel Preview Label), FG isi
   * lewat ProductionLabelEntryFgPage.tsx. */
  extraFields?: ProductionLabelExtraField[];
  /** Label kolom "Lot No" (2026-08-27, instruksi eksplisit user, KHUSUS Label
   * Entry FG) -- default "Lot No" (SFG tidak berubah), FG override ke
   * "Lot Passed" krn nilainya sekarang disambungkan ke Admin QC (lihat prop
   * `autofillLotFromAdminQc`). Field DB/state di baliknya (`lotNo`) TIDAK
   * berubah nama -- ini murni label yg ditampilkan ke user. */
  lotNoLabel?: string;
  /** Autofill kolom "Lot No"/"Lot Passed" dari Admin QC kolom "Lot Passed"
   * Order yg sama (2026-08-27, instruksi eksplisit user, KHUSUS Label Entry
   * FG lewat ProductionLabelEntryFgPage.tsx -- default false, SFG tidak
   * berubah krn Lot No di sana murni manual, tidak ada sumber otomatisnya).
   * HANYA mengisi kalau field masih kosong SETELAH saran dari History
   * Production Label Order ini sendiri (lihat handleOrderFound) -- own
   * history tetap didahulukan krn lebih spesifik (persis apa yg pernah
   * dipakai utk label Order ini), Admin QC cuma fallback utk Order yg belum
   * pernah masuk History label FG. Tetap bisa diedit manual krn ini murni
   * saran, bukan dikunci read-only. */
  autofillLotFromAdminQc?: boolean;
  /** Autofill kolom "Shelf Life (bulan)" dari Material Number yg SAMA di
   * Order LAIN (2026-08-27, instruksi eksplisit user, KHUSUS Label Entry FG
   * lewat ProductionLabelEntryFgPage.tsx -- default false, SFG tidak
   * berubah). Dipakai bareng blok saran Material Type/Drum Colour yg sudah
   * ada (sama sumber `${apiBase}/latest-by-material/:materialNumber`) --
   * KALAH prioritas dari saran History Order ini sendiri di atas (HANYA
   * mengisi kalau shelfLife masih kosong), krn Order-spesifik lebih akurat
   * drpd disamakan lintas Order. Tetap bisa diedit manual, murni saran. */
  autofillShelfLifeFromMaterial?: boolean;
  /** Autofill "Shelf Life (bulan)" dari kombinasi Material Number + Material
   * Type yg SAMA di Order LAIN (2026-08-27, instruksi eksplisit user, KHUSUS
   * Label Entry SFG -- default true krn ini varian default komponen ini,
   * FG explicitly set false lewat ProductionLabelEntryFgPage.tsx krn field
   * Material Type disembunyikan total di FG, tidak relevan di sana; FG
   * pakai `autofillShelfLifeFromMaterial` di atas yg materialNumber SAJA).
   * BEDA dari saran Material Type/Drum Colour yg sudah ada (materialNumber
   * SAJA) -- Material Number yg SAMA bisa punya beberapa Material Type
   * dgn Shelf Life BEDA-BEDA, jadi lookup-nya WAJIB ikut menyaring Material
   * Type juga (lihat useEffect reaktif thd `pasteType` di bawah, BUKAN cuma
   * dipanggil sekali di handleOrderFound spt saran lain -- supaya tetap
   * ikut nyesuaikan begitu Material Type berubah/dipilih manual belakangan).
   * HANYA mengisi kalau Shelf Life masih kosong, tetap bisa diedit manual. */
  autofillShelfLifeFromMaterialAndType?: boolean;
  /** Field "Batch" di sebelah Order, dgn pencarian saling fallback ke Order
   * (2026-11-04, instruksi eksplisit user -- bagian dari penggabungan menu
   * "QR Code Yamaha" ke Label Entry FG, tapi berlaku UMUM utk semua Order FG,
   * bukan cuma Yamaha) -- diteruskan ke `OrderLookup`. Default false (SFG
   * tidak berubah), FG nyalakan lewat ProductionLabelEntryFgPage.tsx. */
  showBatchSearch?: boolean;
  /** Lookup Item No. Yamaha + preview/download QR Code Yamaha (2026-11-04,
   * instruksi eksplisit user) -- SELALU tampil kalau true (TIDAK ada toggle
   * per-Order), tapi TIDAK PERNAH memblokir Save biasa kalau Material-nya
   * bukan Yamaha (field2 terkait cukup kosong/disabled). Default false (SFG
   * tidak berubah), FG nyalakan lewat ProductionLabelEntryFgPage.tsx. */
  showYamahaQr?: boolean;
  /** Kosongkan seluruh form (Order/Batch & semua field manual) otomatis
   * begitu Save/Download QR berhasil (2026-11-04, instruksi eksplisit user,
   * KHUSUS Label Entry FG) -- supaya operator langsung bisa cari Order
   * berikutnya tanpa sisa data lama nyangkut. Pesan "Data tersimpan ke
   * History." TETAP tampil (TIDAK ikut direset) sbg konfirmasi. Default
   * false (SFG tidak berubah -- Preview Label SFG masih dipakai bareng
   * tombol Cetak Label, mengosongkannya otomatis after-print akan
   * menghilangkan preview yg baru dicetak, bukan itu yg diminta). */
  resetFormAfterSave?: boolean;
  /** Lewati POST ke History kalau TIDAK ADA perubahan input dari baris
   * History TERAKHIR Order ini sendiri (2026-11-04, instruksi eksplisit
   * user: "biar tidak boros baris" -- Order/Batch yg dicari sudah pernah
   * masuk History, lalu operator langsung klik Save/Download tanpa
   * mengubah apa pun field manualnya) -- KHUSUS Label Entry FG. Baseline
   * diambil dari baris own-history yg sama persis dipakai utk autofill
   * (lihat `ownHistoryBaseline` di handleOrderFound), dibandingkan ke semua
   * field manual (Lot/Shelf Life/Volume/Viskositas/SG/Jumlah Per/dst,
   * TERMASUK Remark) saat Save/Download diklik. Kalau SAMA PERSIS -> tidak
   * ada baris History baru, cuma tampil pesan info (TIDAK dianggap error).
   * Order yg BELUM PERNAH masuk History (baseline null) SELALU disimpan
   * spt biasa -- validasi ini cuma mencegah DUPLIKAT, bukan mewajibkan
   * perubahan utk entry pertama kali. Default false (SFG tidak berubah). */
  skipSaveIfUnchanged?: boolean;
} = {}) {
  const hidden = new Set(hiddenFields);
  const extra = new Set(extraFields);
  const { data: tanks } = useTankOptions();
  const [tab, setTab] = useState<"input" | "history">("input");
  const [order, setOrder] = useState("");
  const [batch, setBatch] = useState("");
  const [data, setData] = useState<OrderRefData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // QR Code Yamaha (2026-11-04, KHUSUS `showYamahaQr`) -- lihat komentar
  // panjang di useEffect kode gabungan di bawah.
  const [part, setPart] = useState<PartYamaha | null>(null);
  // Lookup MasterPartYamaha SUDAH selesai dicoba (2026-11-04, instruksi
  // eksplisit user) -- true begitu Order ditemukan & lookup-nya
  // selesai/dicek, TERLEPAS dari hasilnya ketemu atau tidak. Dipakai utk
  // validasi "semua kolom wajib diisi": field Item No. Yamaha dianggap
  // SUDAH TERISI begitu ini true (baik tampil Item No. Yamaha-nya ATAUPUN
  // teks "Produk tidak pakai QR Code" -- keduanya jawaban yg lengkap).
  const [yamahaLookupDone, setYamahaLookupDone] = useState(false);
  const [viskositas, setViskositas] = useState("");
  const [sg, setSg] = useState("");
  const [qrYamahaDataUrl, setQrYamahaDataUrl] = useState("");

  const [lotNo, setLotNo] = useState("");
  const [exp, setExp] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [codeTanki, setCodeTanki] = useState("");
  const [iuPlant, setIuPlant] = useState("");
  const [pasteType, setPasteType] = useState("");
  const [drumColour, setDrumColour] = useState("");
  const [volume, setVolume] = useState("");
  const [jumlahPer, setJumlahPer] = useState("");
  const [remark, setRemark] = useState("");
  const [tankOptions, setTankOptions] = useState<MillingTankOption[]>([]);
  const [selectedTankId, setSelectedTankId] = useState("");
  // Snapshot field manual dari baris History TERAKHIR Order ini sendiri
  // (2026-11-04, KHUSUS `skipSaveIfUnchanged`) -- null kalau Order ini
  // BELUM PERNAH masuk History (selalu boleh disimpan) ATAU Order belum
  // dicari sama sekali. Dibandingkan ke field saat ini saat Save/Download
  // diklik -- lihat `saveLabel`.
  const [ownHistoryBaseline, setOwnHistoryBaseline] = useState<FieldSnapshot | null>(null);

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

  // Kode gabungan + QR Code Yamaha (2026-11-04, KHUSUS `showYamahaQr`) --
  // preview real-time di layar, format SAMA PERSIS `buildYamahaCodeYm` server
  // (productionLabelHelpers.ts): TEXT(Lot,"DDMMYYYY") & TEXT(angka dari
  // Volume,"000") & Item No. Yamaha (kolom "Qty Pack" terpisah SUDAH DIHAPUS,
  // 2026-11-04, instruksi eksplisit user -- dianggap redundant dgn Volume,
  // logic-nya pindah ke situ, lihat `parseLeadingNumber`). Kosong (tidak
  // generate QR) kalau Lot/Volume/Item No. Yamaha belum lengkap -- TIDAK ada
  // error block, field2 ini opsional dan mayoritas Order FG bukan Yamaha
  // (Item No. Yamaha-nya memang akan selalu kosong utk Order non-Yamaha).
  const codeYmPreview = showYamahaQr ? buildYamahaCodeYmPreview(lotNo, volume, part?.itemNoYamaha ?? "") : "";

  // Validasi "semua kolom wajib diisi" (2026-11-04, instruksi eksplisit
  // user, berlaku Label Entry SFG DAN FG) -- Save/Download baru aktif kalau
  // SEMUA field manual yg operator isi langsung sudah terisi. KECUALI:
  // Remark (boleh kosong, instruksi eksplisit user), field read-only hasil
  // auto-lookup dari Order (Material Number/Description/Batch/Quantity/
  // Plant -- bukan isian manual, nilainya ikut apa adanya dari Master Data
  // Order, di luar kendali operator), dan Exp (turunan Lot+Shelf Life,
  // otomatis terisi begitu keduanya terisi). Item No. Yamaha KHUSUS --
  // dianggap terisi begitu `yamahaLookupDone` true (lihat komentar
  // state-nya di atas: tampil Item No. Yamaha ATAUPUN teks "Produk tidak
  // pakai QR Code", keduanya jawaban yg lengkap). Field yg disembunyikan
  // lewat `hiddenFields`/tidak dinyalakan lewat `extraFields` utk varian ini
  // (mis. Code Tanki di FG) otomatis TIDAK ikut disyaratkan.
  const allRequiredFilled =
    !!data &&
    (hidden.has("materialType") || pasteType.trim() !== "") &&
    shelfLife.trim() !== "" &&
    lotNo.trim() !== "" &&
    (hidden.has("codeTanki") || codeTanki.trim() !== "") &&
    (hidden.has("iuPlant") || iuPlant.trim() !== "") &&
    (hidden.has("drumColour") || drumColour.trim() !== "") &&
    (!extra.has("jumlahPer") || jumlahPer.trim() !== "") &&
    (!extra.has("volume") || volume.trim() !== "") &&
    (!extra.has("viskositas") || viskositas.trim() !== "") &&
    (!extra.has("sg") || sg.trim() !== "") &&
    (!showYamahaQr || yamahaLookupDone);

  useEffect(() => {
    if (!codeYmPreview) {
      setQrYamahaDataUrl("");
      return;
    }
    let cancelled = false;
    // Opsi SAMA PERSIS yg sudah dikalibrasi di useEffect QR SFG di atas.
    toDataURL(codeYmPreview, { margin: 2, width: 300, errorCorrectionLevel: "L" })
      .then((url) => {
        if (!cancelled) setQrYamahaDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrYamahaDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [codeYmPreview]);

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

  // Autofill "Shelf Life (bulan)" dari kombinasi Material Number + Material
  // Type (2026-08-27, instruksi eksplisit user, KHUSUS `autofillShelfLifeFromMaterialAndType`
  // -- Label Entry SFG) -- REAKTIF thd `pasteType` (bukan cuma sekali saat
  // Order ditemukan spt saran lain di handleOrderFound) supaya tetap ikut
  // menyesuaikan begitu Material Type-nya diketahui belakangan (dari saran
  // materialNumber-only di handleOrderFound) ATAU dipilih manual oleh user --
  // Material Number yg SAMA bisa punya beberapa Material Type dgn Shelf Life
  // BEDA-BEDA, jadi TIDAK cukup materialNumber saja. HANYA mengisi kalau
  // Shelf Life masih kosong (tidak menimpa isian manual/hasil autofill lain),
  // tetap bisa diedit manual.
  useEffect(() => {
    if (!autofillShelfLifeFromMaterialAndType) return;
    const materialNumber = data?.materialNumber;
    const type = pasteType.trim();
    if (!materialNumber || !type) return;
    let cancelled = false;
    api
      .get<{ success: boolean; data: ProductionLabelHistoryRow | null }>(
        `${apiBase}/latest-by-material-and-type/${encodeURIComponent(materialNumber)}/${encodeURIComponent(type)}`
      )
      .then((res) => {
        if (cancelled) return;
        if (res.data?.shelfLife) setShelfLife((v) => v || res.data!.shelfLife || "");
      })
      .catch(() => {
        /* saran dari kombinasi Material Number + Material Type bersifat opsional -- kalau gagal, biarkan user isi manual */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.materialNumber, pasteType, autofillShelfLifeFromMaterialAndType, apiBase]);

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
    setJumlahPer("");
    setRemark("");
    setTankOptions([]);
    setSelectedTankId("");
    // Field QR Code Yamaha (2026-11-04, KHUSUS `showYamahaQr`) -- reset tiap
    // Order baru dicari, sama pola dgn field manual lain di atas.
    setPart(null);
    setYamahaLookupDone(false);
    setViskositas("");
    setSg("");
    setOwnHistoryBaseline(null);
    // Volume (2026-08-20, instruksi eksplisit user, KHUSUS extra.has("volume"))
    // -- default-nya dari Master Data Referensi Order/PO (SAP-COOISPI, sama
    // sumber dgn saran Volume di Packing), TAPI baris History Production
    // Label sendiri utk Order ini (kalau ada, lihat blok `own.data` di bawah)
    // lebih diutamakan krn itu nilai yg BENAR-BENAR dipakai admin terakhir.
    setVolume(found.volume ?? "");

    // Order yang SUDAH PERNAH masuk History Production Label INI SENDIRI
    // (2026-08-20, instruksi eksplisit user) -- semua kolom manual yg pernah
    // diisi admin utk Order ini disarankan lagi dari baris History TERAKHIR,
    // supaya tidak perlu isi ulang dari nol kalau label yg sama mau
    // dicetak ulang/direvisi. Didahulukan drpd saran cross-module di bawah
    // (Code Tanki/IU Plant/Remark) krn lebih spesifik -- persis apa yg
    // pernah dipakai utk label Order ini sendiri.
    let ownCodeTanki = "";
    let ownIuPlant = "";
    let ownRemark = "";
    try {
      const own = await api.get<{ success: boolean; data: ProductionLabelHistoryRow | null }>(
        `${apiBase}/latest-by-order/${encodeURIComponent(found.order)}`
      );
      if (own.data) {
        const latest = own.data;
        const baselineLotNo = parseDDMMYYYYToInputDate(latest.lotNo);
        const baselineVolume = latest.volume || (found.volume ?? "");
        setLotNo(baselineLotNo);
        setShelfLife(latest.shelfLife ?? "");
        setPasteType(latest.pasteType ?? "");
        setDrumColour(latest.drumColour ?? "");
        if (latest.volume) setVolume(latest.volume);
        if (latest.jumlahPer) setJumlahPer(latest.jumlahPer);
        if (latest.viskositas) setViskositas(latest.viskositas);
        if (latest.sg) setSg(latest.sg);
        ownCodeTanki = latest.codeTanki ?? "";
        ownIuPlant = latest.iuPlant ?? "";
        ownRemark = latest.remark ?? "";
        setCodeTanki(ownCodeTanki);
        setIuPlant(ownIuPlant);
        setRemark(ownRemark);
        // Baseline utk `skipSaveIfUnchanged` (2026-11-04) -- field2 di sini
        // PERSIS nilai akhir yg baru di-set di atas (volume pakai formula
        // yg sama dgn `if (latest.volume) setVolume(...)`, field lain yg
        // masih bisa ditambah fallback cross-module/material di bawah SELALU
        // cuma mengisi kalau kosong, jadi aman -- kalau fallback itu
        // mengubah sesuatu, snapshot saat Save nanti otomatis beda dari
        // baseline ini & tetap dianggap "berubah").
        setOwnHistoryBaseline({
          lotNo: baselineLotNo,
          shelfLife: latest.shelfLife ?? "",
          pasteType: latest.pasteType ?? "",
          drumColour: latest.drumColour ?? "",
          volume: baselineVolume,
          jumlahPer: latest.jumlahPer || "",
          viskositas: latest.viskositas || "",
          sg: latest.sg || "",
          codeTanki: ownCodeTanki,
          iuPlant: ownIuPlant,
          remark: ownRemark,
        });
      }
    } catch {
      /* Order ini belum pernah masuk History Production Label -- lanjut ke saran cross-module di bawah */
    }

    // Autofill "Lot No"/"Lot Passed" dari Admin QC kolom "Lot Passed" Order yg
    // SAMA (2026-08-27, instruksi eksplisit user, KHUSUS `autofillLotFromAdminQc`
    // -- Label Entry FG) -- HANYA kalau masih kosong SETELAH saran own-history
    // di atas (own-history lebih spesifik, didahulukan). Lot Passed di Admin QC
    // adalah datetime-local, dipotong ke "yyyy-mm-dd" krn field ini `<input
    // type="date">`. Tetap bisa diedit manual, ini murni saran.
    if (autofillLotFromAdminQc) {
      try {
        const adminQc = await api.get<{ success: boolean; data: AdminQcLatestRow | null }>(
          `/admin-qc/latest-by-order/${encodeURIComponent(found.order)}`
        );
        if (adminQc.data?.lotPassed) {
          const lotPassedDate = toDateTimeLocalValue(adminQc.data.lotPassed).slice(0, 10);
          if (lotPassedDate) setLotNo((v) => v || lotPassedDate);
        }
      } catch {
        /* Order ini belum py Lot Passed di Admin QC -- biarkan kosong, operator isi manual */
      }
    }

    // Lookup Item No. Yamaha dari Material Number (2026-11-04, KHUSUS
    // `showYamahaQr`) -- null kalau Material-nya bukan Yamaha, TIDAK ada
    // error block, field ini memang opsional & mayoritas Order FG bukan
    // Yamaha.
    if (showYamahaQr) {
      if (found.materialNumber) {
        try {
          const partRes = await api.get<{ success: boolean; data: PartYamaha | null }>(
            `${apiBase}/lookup-part/${encodeURIComponent(found.materialNumber)}`
          );
          setPart(partRes.data);
        } catch {
          setPart(null);
        }
      } else {
        setPart(null);
      }
      setYamahaLookupDone(true);
    }

    // Material Type/Drum Colour (SFG) & Shelf Life (FG, lewat
    // `autofillShelfLifeFromMaterial`) dari Material Number yg SAMA di Order
    // LAIN (2026-08-25 & 2026-08-27, instruksi eksplisit user: mempercepat
    // input admin) -- KALAH prioritas dari saran Order-spesifik di atas (skip
    // kalau `own` sudah mengisi salah satunya), krn ketiganya properti
    // Material, bukan Order, jadi wajar disamakan lintas Order. Tetap bisa
    // diedit manual spt biasa (state biasa, bukan read-only).
    if (
      found.materialNumber &&
      (!hidden.has("materialType") || !hidden.has("drumColour") || autofillShelfLifeFromMaterial)
    ) {
      try {
        const matRes = await api.get<{ success: boolean; data: ProductionLabelHistoryRow | null }>(
          `${apiBase}/latest-by-material/${encodeURIComponent(found.materialNumber)}`
        );
        if (matRes.data) {
          if (!hidden.has("materialType")) setPasteType((v) => v || matRes.data!.pasteType || "");
          if (!hidden.has("drumColour")) setDrumColour((v) => v || matRes.data!.drumColour || "");
          if (autofillShelfLifeFromMaterial) setShelfLife((v) => v || matRes.data!.shelfLife || "");
        }
      } catch {
        /* Material ini belum pernah masuk History Production Label -- biarkan kosong, operator isi manual */
      }
    }

    try {
      const res = await api.get<{ success: boolean; data: CrossModuleData }>(
        `${apiBase}/latest-cross-module/${encodeURIComponent(found.order)}`
      );
      setCodeTanki((c) => c || res.data.codeTanki || "");
      setIuPlant((v) => v || res.data.iuPlant || "");
      setRemark((v) => v || res.data.remark || "");
    } catch {
      /* biarkan kosong -- operator isi manual */
    }

    // Dropdown "Pilih Tanki" (2026-08-25) -- KHUSUS SFG (field Code Tanki
    // tidak disembunyikan). Cuma mengisi PILIHAN, TIDAK mengubah nilai
    // codeTanki/iuPlant yg sudah keisi dari own-history/cross-module di atas
    // (default tetap sama spt sebelumnya) -- operator baru override manual
    // kalau memang mau cetak label utk tanki SELAIN yg sudah tersaran.
    if (!hidden.has("codeTanki")) {
      try {
        const tanksRes = await api.get<{ success: boolean; data: MillingTankOption[] }>(
          `${apiBase}/milling-tanks/${encodeURIComponent(found.order)}`
        );
        setTankOptions(tanksRes.data);
      } catch {
        /* Order belum py tanki Milling sama sekali -- dropdown kosong, form tetap bisa dipakai spt biasa */
      }
    }
  }

  /** Pilih tanki tertentu dari dropdown "Pilih Tanki" (2026-08-25) -- timpa
   * Code Tanki/IU Plant/Remark (kolom "Other" di label cetak) dgn nilai
   * tanki itu, supaya label yg dicetak sesuai tanki yg dipilih (Tanki
   * 1/2/3/dst), bukan cuma tanki terakhir. Remark IKUT (bukan cuma Code
   * Tanki/IU Plant) krn tiap baris MillingLog/tanki py Remark sendiri2. */
  function selectTank(tankId: string) {
    setSelectedTankId(tankId);
    const tank = tankOptions.find((t) => String(t.id) === tankId);
    if (!tank) return;
    setCodeTanki(tank.codeTanki ?? "");
    setIuPlant(tank.iuPlant ?? "");
    setRemark(tank.remark ?? "");
  }

  // Mode pop-up "Info Proses Material" (embedded+initialOrder) -- lihat
  // komentar sama di PremixAftermixPage.tsx/MillingPage.tsx.
  useEffect(() => {
    if (!embedded || !initialOrder) return;
    setOrder(initialOrder);
    api
      .get<{ success: boolean; data: OrderRefData }>(`/master-data/orders/${encodeURIComponent(initialOrder)}`)
      .then((res) => handleOrderFound(res.data))
      .catch(() => {
        /* Order tidak ditemukan di Master Data -- biarkan kosong, admin isi manual */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialOrder]);

  /** Kosongkan seluruh form (2026-11-04, KHUSUS `resetFormAfterSave`) --
   * dipanggil setelah Save/Download QR berhasil, SEMUA yg diketik operator
   * direset (Order/Batch pencarian & semua field manual), sama pola reset
   * dgn awal `handleOrderFound` tapi SEKALIGUS Order/Batch/data/part-nya
   * sendiri ikut dikosongkan (beda dari `handleOrderFound` yg justru lagi
   * MENGISI Order baru). `error`/`message` SENGAJA TIDAK direset di sini --
   * biar pesan "Data tersimpan ke History." tetap kelihatan sbg konfirmasi. */
  function resetForm() {
    setOrder("");
    setBatch("");
    setData(null);
    setPart(null);
    setYamahaLookupDone(false);
    setLotNo("");
    setExp("");
    setShelfLife("");
    setCodeTanki("");
    setIuPlant("");
    setPasteType("");
    setDrumColour("");
    setVolume("");
    setJumlahPer("");
    setViskositas("");
    setSg("");
    setRemark("");
    setTankOptions([]);
    setSelectedTankId("");
  }

  /** Simpan form ini sbg baris History baru (2026-08-20, instruksi eksplisit
   * user: tombol Save terpisah supaya jelas acuan "masuk History" itu
   * PERSIS saat tombol ini diklik) -- dipakai baik oleh tombol Save polos
   * MAUPUN Cetak Label (yg Save dulu baru window.print(), lihat handlePrint
   * di bawah). Backend SENGAJA selalu bikin baris BARU tiap dipanggil (bukan
   * upsert/edit), lihat komentar POST / di productionLabel.routes.ts -- jadi
   * Save & Cetak Label yg diklik berurutan utk Order yg sama akan tercatat
   * sbg 2 baris History terpisah, sesuai desain "tiap cetak/simpan adalah
   * kejadian terpisah" -- KECUALI kalau `skipSaveIfUnchanged` aktif DAN tidak
   * ada perubahan dari baseline (lihat blok di bawah), baru request POST-nya
   * dilewati sama sekali. Return true kalau berhasil disimpan ATAU memang
   * sengaja dilewati krn tidak ada perubahan (bukan error). */
  async function saveLabel(): Promise<boolean> {
    if (!data) return false;
    // Validasi Code Tanki dilewati kalau kolomnya disembunyikan (2026-08-20,
    // instruksi eksplisit user: Label Entry FG tidak punya kolom ini) --
    // jangan sampai user terjebak error yg tidak bisa diperbaiki krn field
    // penyebabnya sendiri tidak ditampilkan di form.
    if (!hidden.has("codeTanki") && !isKnownTankCodeOrJoined(tanks, codeTanki)) {
      setError("Code Tanki tidak ditemukan di Master Data Tanki. Pilih dari daftar saran.");
      return false;
    }
    const lotNoDateError = validateNotFutureDate(lotNo, "Lot No");
    if (lotNoDateError) {
      setError(lotNoDateError);
      return false;
    }
    // "Biar tidak boros baris" (2026-11-04, instruksi eksplisit user, KHUSUS
    // `skipSaveIfUnchanged`) -- Order/Batch yg dicari SUDAH PERNAH masuk
    // History (`ownHistoryBaseline` tidak null) DAN semua field manual saat
    // ini PERSIS SAMA dgn baris terakhir itu -> tidak perlu bikin baris
    // History baru, cukup kasih tahu operator. Order yg BELUM PERNAH masuk
    // History (baseline null) SELALU disimpan spt biasa -- ini cuma mencegah
    // DUPLIKAT, bukan mewajibkan perubahan utk entry pertama.
    if (skipSaveIfUnchanged && ownHistoryBaseline) {
      const currentSnapshot: FieldSnapshot = {
        lotNo,
        shelfLife,
        pasteType,
        drumColour,
        volume,
        jumlahPer,
        viskositas,
        sg,
        codeTanki,
        iuPlant,
        remark,
      };
      const unchanged = (Object.keys(currentSnapshot) as (keyof FieldSnapshot)[]).every(
        (key) => currentSnapshot[key] === ownHistoryBaseline[key]
      );
      if (unchanged) {
        setError("");
        setMessage("Tidak ada perubahan input baru -- data tidak disimpan ulang ke History.");
        return true;
      }
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post(apiBase, {
        order: data.order,
        materialNumber: data.materialNumber ?? "",
        materialDescription: data.materialDescription ?? "",
        batch: data.batch ?? "",
        orderQty: data.orderQty ?? "",
        // orderQtyPcs (2026-08-21, instruksi eksplisit user, KHUSUS FG) -- aman
        // dikirim apa adanya walau modul SFG tidak punya kolom ini di skemanya
        // (Zod default STRIP nilai yg tidak dikenal, sama pola dgn volume/jumlahPer).
        orderQtyPcs: data.orderQtyPcs ?? "",
        plant: data.plant ?? "",
        lotNo: formatDateDDMMYYYY(lotNo),
        exp: exp || "",
        shelfLife,
        codeTanki,
        iuPlant,
        pasteType,
        drumColour,
        // Volume (2026-08-20, instruksi eksplisit user, KHUSUS FG) -- aman
        // dikirim apa adanya walau modul SFG tidak punya kolom `volume` di
        // skemanya (Zod default STRIP nilai yg tidak dikenal, bukan error).
        volume,
        jumlahPer,
        remark,
        // Field QR Code Yamaha (2026-11-04, KHUSUS `showYamahaQr`) -- aman
        // dikirim apa adanya walau modul SFG tidak punya kolom ini di
        // skemanya (Zod default STRIP nilai yg tidak dikenal, bukan error).
        // `itemNoYamaha`/`codeYm` TIDAK dikirim -- selalu dihitung ulang
        // server-side dari lookup MasterPartYamaha, bukan dipercaya dari sini.
        viskositas,
        sg,
      });
      setMessage("Data tersimpan ke History.");
      if (resetFormAfterSave) resetForm();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan data.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await saveLabel();
  }

  async function handlePrint() {
    const ok = await saveLabel();
    if (!ok) return;
    setMessage("Label tersimpan ke History.");
    setTimeout(() => window.print(), 200);
  }

  /** Download QR Code Yamaha (2026-11-04, KHUSUS `showYamahaQr`) -- Save dulu
   * (1 aksi = 1 baris History, sama prinsip dgn handlePrint di atas) baru
   * trigger download PNG dari `qrYamahaDataUrl`. Tombolnya sendiri sudah
   * disabled kalau `codeYmPreview` kosong (lihat JSX), jadi fungsi ini aman
   * dipanggil tanpa validasi tambahan di sini. */
  async function handleDownloadQr() {
    const ok = await saveLabel();
    if (!ok || !qrYamahaDataUrl || !codeYmPreview) return;
    const a = document.createElement("a");
    a.href = qrYamahaDataUrl;
    a.download = `QR-${codeYmPreview}.png`;
    a.click();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${tab === "input" ? "" : "btn-outline"}`} onClick={() => setTab("input")}>
            {title}
          </button>
          <button className={`btn ${tab === "history" ? "" : "btn-outline"}`} onClick={() => setTab("history")}>
            History
          </button>
        </div>
      )}

      {!embedded && tab === "history" && (
        <LabelHistoryPage
          apiBase={apiBase}
          showVolumeColumn={extra.has("volume")}
          showJumlahPerColumn={extra.has("jumlahPer")}
          showOrderQtyPcsColumn={extra.has("orderQtyPcs")}
          showYamahaColumns={showYamahaQr}
        />
      )}

      {(embedded || tab === "input") && (
        <>
      <div className="panel label-form-panel">
        <div className="panel-header">{title}</div>
        <div className="panel-body">
          <p style={{ marginTop: 0, marginBottom: 12, color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {showPrintButton
              ? "Cetak label produksi untuk printer Honeywell PC42T (ukuran sticker 100mm x 140mm). Cari nomor Order, lengkapi field manual di bawah, lalu klik Cetak Label."
              : "Cari nomor Order, lengkapi field manual di bawah, lalu klik Save."}
          </p>
          <OrderLookup
            value={order}
            onChange={setOrder}
            onFound={handleOrderFound}
            onNotFound={() =>
              handleOrderFound({
                order,
                batch: null,
                materialNumber: null,
                materialDescription: null,
                orderQty: null,
                plant: null,
                jenis: null,
                warnaDasar: null,
                volume: null,
              })
            }
            showBatchSearch={showBatchSearch}
            batchValue={batch}
            onBatchChange={setBatch}
          />

          {/* Field manual SELALU tampil, tidak lagi menunggu Order ketemu dulu
              (2026-08-20, instruksi eksplisit user: "hilangkan menu awal yang
              hanya menampilkan kolom no order saja" -- langsung ke layout
              lengkap begitu buka menu ini, bukan reveal bertahap). */}
          <div className="field-grid" style={{ marginTop: 12 }}>
            {/* Urutan kolom (2026-08-21, instruksi eksplisit user): Jumlah /Per,
                Shelf Life, Lot No, Exp, Material Number, Material Description,
                Batch, Order quantity (GMEIN)/LITER, Order quantity (GMEIN),
                Volume, baru Remark (paling bawah, di luar blok ini).
                Material Number/Description/Batch/Order Qty/Volume (2026-08-20,
                instruksi eksplisit user, opt-in lewat `extraFields`) -- KHUSUS
                Label Entry FG, krn showPreview=false disana artinya field2 ini
                tidak kelihatan sama sekali lagi (dulu cuma tampil di panel
                Preview Label). Material Number/Description/Batch & Order Qty
                read-only, murni display dari Order Lookup (bukan state
                terpisah). Volume & Jumlah /Per BEDA -- state sendiri, tetap
                bisa diedit manual & ikut tersimpan ke History (kolom DB
                `volume`/`jumlahPer`, cuma ada di ProductionLabelFg). */}
            {/* Pilih Tanki (2026-08-25, instruksi eksplisit user) -- urutan
                kolom (DIREVISI 2026-08-27, instruksi eksplisit user): Order,
                Pilih Tanki, Material Type, Shelf Life (bulan), Lot No, Exp,
                Code Tanki, IU Plant, Drum Colour, Remark. Pilih Tanki
                ditaruh PALING ATAS field-grid (tepat setelah Order) supaya
                operator pilih tanki dulu sebelum isi field lain -- TIDAK ikut
                disebut user di urutan barunya, jadi posisinya dipertahankan
                di depan. */}
            {!hidden.has("codeTanki") && tankOptions.length > 0 && (
              <div className="field">
                <label>Pilih Tanki</label>
                <select value={selectedTankId} onChange={(e) => selectTank(e.target.value)}>
                  <option value="">-- Manual / Saran Otomatis --</option>
                  {tankOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.codeTanki || "-"})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {extra.has("jumlahPer") && (
              <div className="field">
                <label>Jumlah /Per</label>
                <input value={jumlahPer} onChange={(e) => setJumlahPer(e.target.value)} placeholder="mis. 1/200" />
              </div>
            )}
            {!hidden.has("materialType") && (
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
            )}
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
              <label>{lotNoLabel}</label>
              <input type="date" value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
            </div>
            <div className="field">
              <label title="Otomatis: Lot No + Shelf Life">Exp</label>
              <input type="date" value={exp} disabled />
            </div>
            {extra.has("volume") && (
              <div className="field">
                <label>Volume</label>
                <input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="mis. 1x5 Ltr" />
              </div>
            )}
            {extra.has("viskositas") && (
              <div className="field">
                <label>Viskositas</label>
                <input value={viskositas} onChange={(e) => setViskositas(e.target.value)} />
              </div>
            )}
            {extra.has("sg") && (
              <div className="field">
                <label>SG</label>
                <input value={sg} onChange={(e) => setSg(e.target.value)} />
              </div>
            )}
            {extra.has("materialNumber") && (
              <div className="field">
                <label>Material Number</label>
                <input value={data?.materialNumber ?? ""} disabled />
              </div>
            )}
            {extra.has("materialDescription") && (
              <div className="field">
                <label>Material Description</label>
                <input value={data?.materialDescription ?? ""} disabled />
              </div>
            )}
            {extra.has("batch") && (
              <div className="field">
                <label>Batch</label>
                <input value={data?.batch ?? ""} disabled />
              </div>
            )}
            {/* Order quantity (GMEIN)/LITER & Order quantity (GMEIN) (2026-08-21,
                instruksi eksplisit user) -- read-only, murni display dari Order
                Lookup sama pola dgn Material Number/Description/Batch di atas,
                BUKAN state terpisah. `orderQty` = varian /LITER (sudah lama
                ikut tersimpan ke History lewat saveLabel, cuma belum pernah
                ditampilkan di form ini); `orderQtyPcs` = varian Pcs (baru,
                kolom DB `orderQtyPcs` cuma ada di ProductionLabelFg). */}
            {extra.has("orderQtyLiter") && (
              <div className="field">
                <label>Quantity/LITER</label>
                <input value={data?.orderQty ?? ""} disabled />
              </div>
            )}
            {extra.has("orderQtyPcs") && (
              <div className="field">
                <label>Quantity/PCS</label>
                <input value={data?.orderQtyPcs ?? ""} disabled />
              </div>
            )}
            {extra.has("plant") && (
              <div className="field">
                <label>Plant</label>
                <input value={data?.plant ?? ""} disabled />
              </div>
            )}
            {/* Item No. Yamaha (2026-11-04, instruksi eksplisit user -- bagian
                dari penggabungan menu "QR Code Yamaha") -- read-only, dari
                lookup MasterPartYamaha (lihat handleOrderFound). Begitu
                lookup selesai (`yamahaLookupDone`) tapi Material-nya TIDAK
                ketemu, tampilkan teks "Produk tidak pakai QR Code" (instruksi
                eksplisit user) -- bukan kosong/error, field ini SELALU
                tampil & TIDAK memblokir Save biasa, tapi dianggap "terisi"
                utk validasi semua kolom wajib (lihat `allRequiredFilled`). */}
            {extra.has("itemNoYamaha") && (
              <div className="field">
                <label title="Dari Master Part Yamaha, dicari otomatis dari Kode Material">Item No. Yamaha</label>
                <input value={part ? part.itemNoYamaha : yamahaLookupDone ? "Produk tidak pakai QR Code" : ""} disabled />
              </div>
            )}
            {!hidden.has("codeTanki") && (
              <TankSelect id="production-label-code-tanki" value={codeTanki} onChange={setCodeTanki} required={false} />
            )}
            {!hidden.has("iuPlant") && (
              <IuPlantSelect id="production-label-iu-plant" value={iuPlant} onChange={setIuPlant} plant={data?.plant ?? ""} required={false} />
            )}
            {!hidden.has("drumColour") && (
              <div className="field">
                <label>Drum Colour</label>
                <input value={drumColour} onChange={(e) => setDrumColour(e.target.value)} placeholder="Warna drum" />
              </div>
            )}
            {/* Tombol Save dipindah ke atas Remark (2026-08-20, instruksi
                eksplisit user) -- KHUSUS layout minimal (`!showPreview`, mis.
                Label Entry FG) yg tidak lagi punya panel Preview Label
                terpisah di bawah utk menampungnya (lihat gerbang
                `showPreview` di panel kedua). Layout SFG (showPreview=true)
                TIDAK berubah -- Save-nya tetap di panel Preview Label spt
                sebelumnya, sengaja tidak dipindah krn masih dipakai bareng
                tombol Cetak Label & preview visual di sana. */}
            {!showPreview && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" type="button" disabled={saving || !allRequiredFilled} onClick={handleSave}>
                        {saving ? "Menyimpan..." : "💾 Save"}
                      </button>
                      {showYamahaQr && (
                        <button
                          className="btn btn-outline"
                          type="button"
                          disabled={saving || !allRequiredFilled || !qrYamahaDataUrl}
                          onClick={handleDownloadQr}
                        >
                          {saving ? "Menyimpan..." : "⭳ Download QR"}
                        </button>
                      )}
                    </div>
                    {!data && (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "4px 0 0" }}>
                        Cari nomor Order dulu di atas untuk mengaktifkan Save.
                      </p>
                    )}
                    {/* Semua kolom wajib diisi (2026-11-04, instruksi eksplisit
                        user, kecuali Remark) sblm Save/Download aktif -- lihat
                        `allRequiredFilled`. */}
                    {data && !allRequiredFilled && (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "4px 0 0" }}>
                        Lengkapi semua kolom (kecuali Remark) dulu untuk mengaktifkan Save{showYamahaQr ? "/Download QR" : ""}.
                      </p>
                    )}
                    {/* Download QR Code Yamaha (2026-11-04) -- disabled TANPA
                        error block kalau Item No. Yamaha/Lot/Volume (angka)
                        belum lengkap, cuma teks bantuan singkat (mayoritas
                        Order FG memang bukan Yamaha, jadi tombol ini wajar
                        nonaktif di situ). */}
                    {showYamahaQr && data && allRequiredFilled && !qrYamahaDataUrl && (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "4px 0 0", maxWidth: 320 }}>
                        Download QR tersedia kalau Item No. Yamaha, Lot, dan Volume (berisi angka) terisi (khusus Material yang terdaftar di Master Part Yamaha).
                      </p>
                    )}
                  </div>
                  {/* Preview QR Code Yamaha (2026-11-04, instruksi eksplisit
                      user: tampilkan gambar QR-nya langsung, bukan cuma
                      tombol download) -- ukuran sama persis spt panel
                      "Preview QR" di menu "QR Code Yamaha" yg lama (220x220). */}
                  {showYamahaQr && qrYamahaDataUrl && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <img src={qrYamahaDataUrl} alt={`QR ${codeYmPreview}`} style={{ width: 220, height: 220 }} />
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)", wordBreak: "break-all", textAlign: "center", maxWidth: 220 }}>
                        Kode: <strong>{codeYmPreview}</strong>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Remark</label>
              <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
          {message && <p className="status-text">{message}</p>}
        </div>
      </div>

      {/* Panel Preview + tombol Save/Cetak Label -- HANYA render kalau
          `showPreview` (2026-08-20, instruksi eksplisit user: layout minimal
          spt Label Entry FG tidak perlu panel ini sama sekali lagi, tombol
          Save-nya sudah dipindah ke atas Remark di panel form -- lihat
          gerbang `!showPreview` di atas). Utk showPreview=true (SFG), SELALU
          tampil tidak menunggu Order ketemu dulu (2026-08-20 sebelumnya:
          tombolnya sempat "hilang" krn ikut tersembunyi di balik gerbang
          `{data && ...}` yg sama dgn field manual -- sekarang dipisah,
          tombolnya cuma di-disable & preview tampil placeholder "-" selama
          Order belum ditemukan, TIDAK ikut hilang total). */}
      {showPreview && (
      <div className="panel label-print-panel">
          <div className="panel-header label-form-panel">Preview Label{data ? ` — Order ${data.order}` : ""}</div>
          <div className="panel-body">
            <div className="label-toolbar">
              <button className={`btn ${showPrintButton ? "btn-outline" : ""}`} type="button" disabled={saving || !allRequiredFilled} onClick={handleSave}>
                {saving ? "Menyimpan..." : "💾 Save"}
              </button>
              {showPrintButton && (
                <button className="btn" type="button" disabled={saving || !allRequiredFilled} onClick={handlePrint}>
                  {saving ? "Menyimpan..." : "🖨️ Cetak Label"}
                </button>
              )}
            </div>
            {!data && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                Cari nomor Order dulu di atas untuk mengaktifkan {showPrintButton ? "Save/Cetak Label" : "Save"}.
              </p>
            )}
            {/* Semua kolom wajib diisi (2026-11-04, instruksi eksplisit user,
                kecuali Remark) sblm Save/Cetak Label aktif -- lihat
                `allRequiredFilled`. */}
            {data && !allRequiredFilled && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                Lengkapi semua kolom (kecuali Remark) dulu untuk mengaktifkan {showPrintButton ? "Save/Cetak Label" : "Save"}.
              </p>
            )}
            {showPreview && (
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
                  Batch <span className="label-order-value">{data?.batch || "-"}</span>
                </p>
                <div className="label-order-barcode">
                  <BarcodeSvg value={data?.batch ?? ""} />
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
                    <p className="label-cell-value-lg">{data?.materialNumber || "-"}</p>
                  </div>
                </div>

                <hr className="label-rule" />
                <div className="label-row">
                  <div className="label-cell" style={{ flex: "1 1 100%" }}>
                    <p className="label-cell-label">Material Description</p>
                    <p className="label-cell-value-lg">{data?.materialDescription || "-"}</p>
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
                    <p className="label-bottom-tag">Order {data?.order || "-"}</p>
                    <BarcodeSvg value={data?.order ?? ""} />
                  </div>
                  <div className="label-qr">{qrDataUrl && <img src={qrDataUrl} alt={`QR ${data?.order ?? ""}`} />}</div>
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
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
