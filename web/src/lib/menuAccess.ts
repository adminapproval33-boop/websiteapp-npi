import { StoredSession } from "../api/client";

/** HARUS sinkron dgn server/src/lib/menuAccess.ts (MENU_KEYS) -- 2026-08-03,
 * instruksi eksplisit user: level View/Input/Hide per menu, diatur lewat
 * User Management. */
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
  /// eksplisit user) -- "bookingScheduleTanki" DIREVISI sesi ini jadi
  /// satu-satunya gate utk SEMUA jalan booking tanki (Info Proses, klik
  /// kartu Kalender, "+Input Manual Schedule"). Lihat komentar lengkap di
  /// server/src/lib/menuAccess.ts.
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

/** Path menu (lihat layout/menu.tsx) -> MenuKey -- dipakai utk sembunyikan
 * item sidebar yg level-nya "HIDE" (lihat layout/menu.tsx, filterHiddenMenus). */
export const MENU_KEY_BY_PATH: Record<string, MenuKey> = {
  "/planning/premix": "premix",
  "/planning/milling": "milling",
  "/planning/aftermix": "aftermix",
  "/planning/colour-matching": "colourMatching",
  "/planning/bongkaran": "bongkaran",
  "/planning/approval": "approval",
  "/planning/packing": "packing",
  "/qc/product-spec": "productSpec",
  "/qc/check-results": "checkResults",
  "/qc/admin-qc": "adminQc",
  "/maintenance/form": "maintenance",
  "/production-label/entry": "productionLabel",
  "/production-label/entry-fg": "productionLabelFg",
  "/pr/entry": "purchaseRequisition",
  "/pr/history": "purchaseRequisition",
  "/pr/monitoring": "purchaseRequisition",
  "/warehouse/kepala-warna": "kepalaWarna",
};

export type MenuLevel = "VIEW" | "INPUT" | "HIDE";

/** Level akses efektif user ini utk menu `key` -- SAMA PERSIS logikanya dgn
 * getMenuLevel di server/src/lib/menuAccess.ts (harus tetap sinkron). */
export function getMenuLevel(
  user: Pick<StoredSession, "access" | "hiddenMenus" | "viewOnlyMenus"> | null | undefined,
  key: MenuKey
): MenuLevel {
  if (!user || user.access === "FULL_ACCESS") return "INPUT";
  if (user.hiddenMenus.includes(key)) return "HIDE";
  if (user.viewOnlyMenus.includes(key)) return "VIEW";
  return "INPUT";
}
