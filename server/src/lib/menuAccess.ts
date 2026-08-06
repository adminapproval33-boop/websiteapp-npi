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
  "purchaseRequisition",
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
  productionLabel: "Production Label",
  purchaseRequisition: "Purchase Requisition",
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
