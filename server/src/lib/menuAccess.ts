/**
 * Daftar menu yang bisa diatur level aksesnya per-user lewat User Management
 * (2026-08-03, instruksi eksplisit user: 3 level -- View/Input/Hide, bukan
 * cuma binary "dibatasi atau tidak"). Key di sini dipakai di 2 tempat yg
 * HARUS selalu sinkron:
 * 1. `User.hiddenMenus`/`User.viewOnlyMenus` (Prisma, String[]).
 * 2. `requireMenuView(key)`/`requireMenuInput(key)` di middleware/auth.ts,
 *    dipasang di route tiap modul terkait.
 */
export const MENU_KEYS = [
  "premix",
  "milling",
  "aftermix",
  "colourMatching",
  "bongkaran",
  "approval",
  "packing",
  "productSpec",
  "checkResults",
  "adminQc",
  "maintenance",
  "productionLabel",
  "productionLabelFg",
  "purchaseRequisition",
  "kepalaWarna",
  /// 4 tombol toolbar Production Order Monitoring (2026-11-16, instruksi
  /// eksplisit user) -- "newPoProduk" murni navigasi/buka popup, jadi di
  /// situ levelnya cuma menentukan tombolnya TAMPIL atau TIDAK (Hide),
  /// View & Input berperilaku sama. "pindahTanki" & "inputManualPo" py
  /// Save sendiri (POST /dashboard/pindah-tanki &
  /// productionOrderManualInputRouter), jadi View di situ beneran
  /// membedakan "bisa lihat" vs "bisa Save".
  /// "bookingScheduleTanki" DIREVISI sesi ini (2026-11-16, instruksi
  /// eksplisit user): key ini SEKARANG jadi satu-satunya gate utk SEMUA
  /// jalan booking tanki (Info Proses "Booking" di MaterialFlowPanel.tsx,
  /// klik kartu Kalender -> BookingEditModal, & "+Input Manual Schedule"
  /// di PremixAftermixPage.tsx) -- bukan cuma navigasi lagi. View beneran
  /// membedakan "bisa lihat jadwal/booking" vs "bisa booking/edit/batal",
  /// krn ke-4 endpoint /tank-manual-input/booking* di server digerbangi
  /// requireMenuView/requireMenuInput("bookingScheduleTanki") langsung,
  /// terlepas dari menu mana (premix/aftermix/dashboard) yg mengaksesnya.
  "pindahTanki",
  "bookingScheduleTanki",
  "inputManualPo",
  "newPoProduk",
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

export const MENU_LABELS: Record<MenuKey, string> = {
  premix: "Premix",
  milling: "Milling",
  aftermix: "Aftermix",
  colourMatching: "Colour Matching",
  bongkaran: "Bongkaran",
  approval: "Approval",
  packing: "Packing",
  productSpec: "Creating Product Spek",
  checkResults: "Input Check Results",
  adminQc: "Input Admin QC",
  maintenance: "Maintenance",
  productionLabel: "Label Entry SFG",
  productionLabelFg: "Label Entry FG",
  purchaseRequisition: "Purchase Requisition",
  kepalaWarna: "Stok Kepala Warna",
  pindahTanki: "Pindah Tanki (Production Order)",
  bookingScheduleTanki: "Booking & Schedule Tanki (Production Order)",
  inputManualPo: "+Input Manual (Production Order)",
  newPoProduk: "+New PO Produk (Production Order)",
};

export function isMenuKey(v: unknown): v is MenuKey {
  return typeof v === "string" && (MENU_KEYS as readonly string[]).includes(v);
}

export type MenuLevel = "VIEW" | "INPUT" | "HIDE";

/** Level akses efektif user ini utk menu `key` -- FULL_ACCESS SELALU "INPUT"
 * (bypass total, tidak peduli hiddenMenus/viewOnlyMenus-nya), `hiddenMenus`
 * menang atas `viewOnlyMenus` kalau somehow ada di keduanya (seharusnya tidak
 * pernah terjadi lewat UI, dropdown per-menu cuma 1 pilihan), default (tidak
 * ada di keduanya) = "INPUT" (akses penuh, sama spt sebelum fitur ini ada). */
export function getMenuLevel(
  auth: { access: "INPUT" | "VIEW" | "FULL_ACCESS"; hiddenMenus: string[]; viewOnlyMenus: string[] },
  key: MenuKey
): MenuLevel {
  if (auth.access === "FULL_ACCESS") return "INPUT";
  if (auth.hiddenMenus.includes(key)) return "HIDE";
  if (auth.viewOnlyMenus.includes(key)) return "VIEW";
  return "INPUT";
}
