/**
 * Qty/Man = Order Qty dibagi jumlah member yang mengerjakan.
 * Mis. Order Qty 100, dikerjakan 5 member -> 100 / 5 = 20.
 * Kosong kalau Order Qty belum diisi/bukan angka, atau belum ada member.
 */
export function computeQtyPerMan(orderQty: string, memberCount: number): string {
  const qty = Number(orderQty);
  if (!orderQty.trim() || Number.isNaN(qty) || memberCount <= 0) return "";
  const result = qty / memberCount;
  return Number.isInteger(result) ? String(result) : result.toFixed(2);
}

/**
 * Form/Man = 1 no Order (form ini sendiri) dibagi jumlah member yang mengerjakan.
 * Mis. 1 member -> 1 / 1 = 1. 2 member -> 1 / 2 = 0.5. Tidak terkait Order Qty.
 */
export function computeFormPerMan(memberCount: number): string {
  if (memberCount <= 0) return "";
  const result = 1 / memberCount;
  return Number.isInteger(result) ? String(result) : result.toFixed(2);
}

/**
 * Qty/Man (Ltr) khusus PACKING = (Qty/Pcs dikali Volume) dibagi jumlah member
 * yang mengerjakan, sesuai instruksi eksplisit user (2026-07-26, direvisi dari
 * versi awal yg belum dibagi member). Mis. Qty/Pcs 12 x Volume 5 = 60,
 * dikerjakan 2 member -> 60 / 2 = 30, 1 member -> 60 / 1 = 60. BEDA dgn
 * computeQtyPerMan di atas (Order Qty dibagi jumlah member, dipakai
 * Premix/Aftermix). Kosong kalau Qty/Pcs atau Volume belum diisi/bukan angka,
 * atau belum ada member.
 */
export function computeQtyPerManFromPcsVolume(qtyPcs: string, volume: string, memberCount: number): string {
  const pcs = Number(qtyPcs);
  const vol = Number(volume);
  if (!qtyPcs.trim() || !volume.trim() || Number.isNaN(pcs) || Number.isNaN(vol) || memberCount <= 0) return "";
  const result = (pcs * vol) / memberCount;
  return Number.isInteger(result) ? String(result) : result.toFixed(2);
}
