import ProductionLabelEntryPage from "./ProductionLabelEntryPage";

/** Label Entry FG (2026-08-20, instruksi eksplisit user) -- tampilan &
 * logika SAMA dgn Label Entry SFG (ProductionLabelEntryPage.tsx): beda
 * `apiBase` (History-nya TERPISAH TOTAL, tabel Prisma sendiri
 * `ProductionLabelFg`, lihat productionLabelFg.routes.ts) & `title`,
 * `showPrintButton={false}` -- FG cuma perlu tombol Save (tanpa Cetak
 * Label), `showPreview={false}` -- tanpa panel mockup label fisik, DAN
 * `hiddenFields` -- kolom Material Type/Drum Colour/Code Tanki/IU Plant
 * tidak relevan utk FG, DAN `extraFields` -- Material Number/Description/
 * Batch (read-only, krn Preview yg dulu menampilkannya sudah tidak ada),
 * Volume (auto-saran dari Referensi Order/PO, editable, tersimpan ke
 * History -- kolom DB `volume` khusus ada di ProductionLabelFg), & Jumlah
 * /Per (2026-08-21, isian bebas format "1/200", tidak ada sumber otomatis --
 * kolom DB `jumlahPer` khusus ada di ProductionLabelFg), & Order quantity
 * (GMEIN)/LITER + Order quantity (GMEIN) (2026-08-21, read-only, langsung
 * dari Referensi Order/PO SAP-COOISPI -- varian /LITER `orderQty` sudah lama
 * tersimpan ke History tapi baru sekarang ditampilkan di form, varian Pcs
 * `orderQtyPcs` kolom DB baru khusus ProductionLabelFg). Pola
 * reuse-komponen-lewat-prop ini sama dgn
 * PremixAftermixPage.tsx yg dipakai ulang utk menu Premix & Aftermix lewat
 * prop `section`.
 * `lotNoLabel="Lot Passed"` + `autofillLotFromAdminQc` (2026-08-27, instruksi
 * eksplisit user) -- kolom "Lot No" KHUSUS di FG ini diganti tampilannya jadi
 * "Lot Passed" & disambungkan ke Admin QC kolom "Lot Passed" Order yg sama
 * (autofill, tetap bisa diedit manual). SFG TIDAK berubah (masih "Lot No",
 * masih murni manual) krn prop ini defaultnya false/"Lot No" di komponen dasar.
 * `autofillShelfLifeFromMaterial` (2026-08-27, instruksi eksplisit user) --
 * kolom "Shelf Life (bulan)" KHUSUS di FG ini disambungkan ke Material Number
 * yg SAMA di History Label FG (bukan Order yg sama -- lintas Order, krn Shelf
 * Life properti Material). HANYA Shelf Life, TIDAK ada field lain yg ikut
 * (instruksi eksplisit user: "hanya kolom Shelf Life saja yang auto fill").
 * `autofillShelfLifeFromMaterialAndType={false}` (2026-08-27) -- varian BARU
 * Shelf Life (materialNumber + Material Type, KHUSUS Label Entry SFG, lihat
 * komentar propnya di ProductionLabelEntryPage.tsx) SENGAJA dimatikan di FG
 * krn field Material Type disembunyikan total di sini (`hiddenFields` di
 * atas) -- FG sudah punya varian sendiri (`autofillShelfLifeFromMaterial`,
 * materialNumber SAJA) yg lebih cocok. */
export default function ProductionLabelEntryFgPage() {
  return (
    <ProductionLabelEntryPage
      apiBase="/production-label-fg"
      title="Label Entry FG"
      showPrintButton={false}
      showPreview={false}
      hiddenFields={["materialType", "drumColour", "codeTanki", "iuPlant"]}
      extraFields={["materialNumber", "materialDescription", "batch", "orderQtyLiter", "orderQtyPcs", "volume", "jumlahPer"]}
      lotNoLabel="Lot Passed"
      autofillLotFromAdminQc
      autofillShelfLifeFromMaterial
      autofillShelfLifeFromMaterialAndType={false}
    />
  );
}
