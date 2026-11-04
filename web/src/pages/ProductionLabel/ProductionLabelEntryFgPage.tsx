import ProductionLabelEntryPage from "./ProductionLabelEntryPage";

/** Field QR Code Yamaha + pencarian by Batch (2026-11-04, instruksi eksplisit
 * user) -- menu "QR Code Yamaha" yg tadinya terpisah DIGABUNG ke sini: field
 * Item No. Yamaha/Viskositas/SG + tombol Download QR SELALU tampil (tidak
 * ada toggle Customer: Yamaha), tapi TIDAK memblokir Save biasa kalau
 * Material-nya bukan Yamaha -- lihat `showYamahaQr` di ProductionLabelEntryPage.tsx.
 * `showBatchSearch` (field Batch di sebelah Order, saling fallback) berlaku
 * UMUM utk semua Order FG, bukan cuma Yamaha. `"batch"` dihapus dari
 * `extraFields` lama (dulu display read-only di grid) krn sekarang Batch
 * sudah jadi field pencarian aktif di atas, redundant kalau dobel. Field
 * "Qty Pack" terpisah (2026-11-04) DIHAPUS lagi -- logic-nya PINDAH ke
 * kolom Volume yg sudah ada (ambil angka pertama di isiannya), instruksi
 * eksplisit user: dianggap redundant dgn Volume. `resetFormAfterSave`
 * (2026-11-04, instruksi eksplisit user, KHUSUS FG) -- form dikosongkan
 * total begitu Save/Download QR berhasil, biar operator langsung bisa cari
 * Order berikutnya tanpa sisa data lama. `skipSaveIfUnchanged` (2026-11-04,
 * instruksi eksplisit user: "biar tidak boros baris") -- kalau Order/Batch
 * yg dicari sudah pernah masuk History & TIDAK ADA field manual yg diubah
 * dari baris terakhirnya, Save/Download TIDAK bikin baris History baru. */

/** Label Entry FG (2026-08-20, instruksi eksplisit user) -- tampilan &
 * logika SAMA dgn Label Entry SFG (ProductionLabelEntryPage.tsx): beda
 * `apiBase` (History-nya TERPISAH TOTAL, tabel Prisma sendiri
 * `ProductionLabelFg`, lihat productionLabelFg.routes.ts) & `title`,
 * `showPrintButton={false}` -- FG cuma perlu tombol Save (tanpa Cetak
 * Label), `showPreview={false}` -- tanpa panel mockup label fisik, DAN
 * `hiddenFields` -- kolom Material Type/Drum Colour/Code Tanki/IU Plant
 * tidak relevan utk FG, DAN `extraFields` -- Material Number/Description/
 * Batch (read-only, krn Preview yg dulu menampilkannya sudah tidak ada),
 * Volume -- label tampil "Qty Pack" (diganti 2026-11-04, instruksi eksplisit
 * user, kolom DB `volume` TIDAK berubah) -- editable, auto-saran HANYA dari
 * baris History Production Label Order ini sendiri kalau ada (saran dari
 * Referensi Order/PO SAP-COOISPI SUDAH DIHAPUS, 2026-11-04, instruksi
 * eksplisit user), tersimpan ke History -- kolom DB `volume` khusus ada di
 * ProductionLabelFg, & Jumlah /Per (2026-08-21, isian bebas format
 * "1/200", tidak ada sumber otomatis --
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
 * Life properti Material). Awalnya HANYA Shelf Life yg ikut (instruksi
 * eksplisit user 2026-08-27: "hanya kolom Shelf Life saja yang auto fill"),
 * TAPI 2026-11-04 user minta "Qty Pack" (`volume`) pakai acuan PERSIS sama --
 * lihat `autofillVolumeFromMaterial` di bawah (fallback TERPISAH, bukan
 * menimpa batasan lama ini -- Material Type/Drum Colour SFG tetap tidak
 * ikut Qty Pack).
 * `autofillVolumeFromMaterial` (2026-11-04, instruksi eksplisit user) --
 * sama persis pola `autofillShelfLifeFromMaterial` di atas, tapi utk kolom
 * "Qty Pack" (`volume`): utama by No Order dulu (own-history, lihat
 * `handleOrderFound`), BARU fallback by Material Number lintas Order kalau
 * Order ini belum pernah masuk History.
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
      extraFields={[
        "materialNumber",
        "materialDescription",
        "orderQtyLiter",
        "orderQtyPcs",
        "plant",
        "itemNoYamaha",
        "volume",
        "jumlahPer",
        "viskositas",
        "sg",
      ]}
      lotNoLabel="Lot Passed"
      autofillLotFromAdminQc
      autofillShelfLifeFromMaterial
      autofillVolumeFromMaterial
      autofillShelfLifeFromMaterialAndType={false}
      showBatchSearch
      showYamahaQr
      resetFormAfterSave
      skipSaveIfUnchanged
    />
  );
}
