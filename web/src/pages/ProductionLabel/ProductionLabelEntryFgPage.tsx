import ProductionLabelEntryPage from "./ProductionLabelEntryPage";

/** Label Entry FG (2026-08-20, instruksi eksplisit user) -- tampilan &
 * logika SAMA dgn Label Entry SFG (ProductionLabelEntryPage.tsx): beda
 * `apiBase` (History-nya TERPISAH TOTAL, tabel Prisma sendiri
 * `ProductionLabelFg`, lihat productionLabelFg.routes.ts) & `title`,
 * `showPrintButton={false}` -- FG cuma perlu tombol Save (tanpa Cetak
 * Label), `showPreview={false}` -- tanpa panel mockup label fisik, DAN
 * `hiddenFields` -- kolom Material Type/Drum Colour/Code Tanki/IU Plant
 * tidak relevan utk FG, DAN `extraFields` -- Material Number/Description/
 * Batch (read-only, krn Preview yg dulu menampilkannya sudah tidak ada) &
 * Volume (auto-saran dari Referensi Order/PO, editable, tersimpan ke
 * History -- kolom DB `volume` khusus ada di ProductionLabelFg). Pola
 * reuse-komponen-lewat-prop ini sama dgn
 * PremixAftermixPage.tsx yg dipakai ulang utk menu Premix & Aftermix lewat
 * prop `section`. */
export default function ProductionLabelEntryFgPage() {
  return (
    <ProductionLabelEntryPage
      apiBase="/production-label-fg"
      title="Label Entry FG"
      showPrintButton={false}
      showPreview={false}
      hiddenFields={["materialType", "drumColour", "codeTanki", "iuPlant"]}
      extraFields={["materialNumber", "materialDescription", "batch", "volume"]}
    />
  );
}
