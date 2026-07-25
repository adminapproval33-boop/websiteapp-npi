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
