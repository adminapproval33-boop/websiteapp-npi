import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SymbolEntry {
  char: string;
  label: string;
}

/** Daftar simbol per kategori (2026-08-09, instruksi eksplisit user: mau
 * sebanyak & serapi pilihan "Insert Symbol" di MS Word/Excel) -- SENGAJA
 * dikurasi ke simbol yang relevan utk dokumen teknis/QC (bukan seluruh
 * charmap Unicode spt Word, itu ribuan karakter & sebagian besar tidak
 * relevan di sini), dikelompokkan per kategori + kotak cari supaya tetap
 * gampang ditemukan walau jumlahnya banyak. */
const CATEGORIES: Record<string, SymbolEntry[]> = {
  Umum: [
    { char: "°", label: "Derajat" },
    { char: "§", label: "Section" },
    { char: "¶", label: "Paragraf" },
    { char: "©", label: "Copyright" },
    { char: "®", label: "Registered" },
    { char: "™", label: "Trademark" },
    { char: "‰", label: "Permil" },
    { char: "№", label: "Numero" },
    { char: "·", label: "Titik tengah" },
    { char: "…", label: "Elipsis" },
    { char: "†", label: "Dagger" },
    { char: "‡", label: "Double dagger" },
    { char: "•", label: "Bullet" },
    { char: "✓", label: "Centang" },
    { char: "✗", label: "Silang" },
    { char: "★", label: "Bintang" },
    { char: "☆", label: "Bintang kosong" },
    { char: "~", label: "Kira-kira (tilde)" },
    { char: "„", label: "Kutip bawah" },
    { char: "‘", label: "Kutip tunggal buka" },
    { char: "’", label: "Kutip tunggal tutup" },
    { char: "“", label: "Kutip ganda buka" },
    { char: "”", label: "Kutip ganda tutup" },
    { char: "–", label: "En dash" },
    { char: "—", label: "Em dash" },
  ],
  Matematika: [
    { char: "±", label: "Plus-minus" },
    { char: "×", label: "Kali" },
    { char: "÷", label: "Bagi" },
    { char: "=", label: "Sama dengan" },
    { char: "≠", label: "Tidak sama dengan" },
    { char: "≈", label: "Kira-kira sama dengan" },
    { char: "≤", label: "Kurang dari sama dengan" },
    { char: "≥", label: "Lebih dari sama dengan" },
    { char: "<", label: "Kurang dari" },
    { char: ">", label: "Lebih dari" },
    { char: "√", label: "Akar" },
    { char: "∞", label: "Tak hingga" },
    { char: "∑", label: "Sigma (jumlah)" },
    { char: "∏", label: "Pi (perkalian)" },
    { char: "∫", label: "Integral" },
    { char: "∂", label: "Turunan parsial" },
    { char: "∆", label: "Delta (perubahan)" },
    { char: "∇", label: "Nabla" },
    { char: "∈", label: "Anggota dari" },
    { char: "∉", label: "Bukan anggota dari" },
    { char: "⊂", label: "Subset" },
    { char: "∪", label: "Union" },
    { char: "∩", label: "Interseksi" },
    { char: "%", label: "Persen" },
  ],
  Yunani: [
    { char: "α", label: "Alpha" },
    { char: "β", label: "Beta" },
    { char: "γ", label: "Gamma" },
    { char: "δ", label: "Delta" },
    { char: "ε", label: "Epsilon" },
    { char: "ζ", label: "Zeta" },
    { char: "η", label: "Eta" },
    { char: "θ", label: "Theta" },
    { char: "ι", label: "Iota" },
    { char: "κ", label: "Kappa" },
    { char: "λ", label: "Lambda" },
    { char: "μ", label: "Mu (huruf Yunani)" },
    { char: "ν", label: "Nu" },
    { char: "ξ", label: "Xi" },
    { char: "π", label: "Pi" },
    { char: "ρ", label: "Rho" },
    { char: "σ", label: "Sigma" },
    { char: "τ", label: "Tau" },
    { char: "φ", label: "Phi" },
    { char: "χ", label: "Chi" },
    { char: "ψ", label: "Psi" },
    { char: "ω", label: "Omega" },
    { char: "Γ", label: "Gamma besar" },
    { char: "Δ", label: "Delta besar" },
    { char: "Θ", label: "Theta besar" },
    { char: "Λ", label: "Lambda besar" },
    { char: "Σ", label: "Sigma besar" },
    { char: "Φ", label: "Phi besar" },
    { char: "Ψ", label: "Psi besar" },
    { char: "Ω", label: "Omega besar (Ohm)" },
  ],
  Panah: [
    { char: "→", label: "Panah kanan" },
    { char: "←", label: "Panah kiri" },
    { char: "↑", label: "Panah atas" },
    { char: "↓", label: "Panah bawah" },
    { char: "↔", label: "Panah kiri-kanan" },
    { char: "↕", label: "Panah atas-bawah" },
    { char: "⇒", label: "Panah ganda kanan" },
    { char: "⇐", label: "Panah ganda kiri" },
    { char: "⇔", label: "Panah ganda kiri-kanan" },
  ],
  "Pangkat/Indeks": [
    { char: "⁰", label: "Pangkat 0" },
    { char: "¹", label: "Pangkat 1" },
    { char: "²", label: "Pangkat 2" },
    { char: "³", label: "Pangkat 3" },
    { char: "⁴", label: "Pangkat 4" },
    { char: "⁵", label: "Pangkat 5" },
    { char: "₀", label: "Indeks 0" },
    { char: "₁", label: "Indeks 1" },
    { char: "₂", label: "Indeks 2" },
    { char: "₃", label: "Indeks 3" },
  ],
  "Satuan Teknis": [
    { char: "Ω", label: "Ohm" },
    { char: "µ", label: "Mikro" },
    { char: "∅", label: "Diameter" },
    { char: "′", label: "Menit (prime)" },
    { char: "″", label: "Detik (double prime)" },
    { char: "℃", label: "Derajat Celcius" },
    { char: "℉", label: "Derajat Fahrenheit" },
    { char: "㎜", label: "Milimeter" },
    { char: "㎝", label: "Sentimeter" },
    { char: "㎏", label: "Kilogram" },
  ],
  "Mata Uang": [
    { char: "$", label: "Dollar" },
    { char: "€", label: "Euro" },
    { char: "£", label: "Poundsterling" },
    { char: "¥", label: "Yen/Yuan" },
    { char: "₩", label: "Won" },
    { char: "¢", label: "Sen" },
  ],
  Pecahan: [
    { char: "½", label: "Setengah" },
    { char: "⅓", label: "Sepertiga" },
    { char: "⅔", label: "Dua pertiga" },
    { char: "¼", label: "Seperempat" },
    { char: "¾", label: "Tiga perempat" },
    { char: "⅛", label: "Seperdelapan" },
    { char: "⅜", label: "Tiga perdelapan" },
    { char: "⅝", label: "Lima perdelapan" },
    { char: "⅞", label: "Tujuh perdelapan" },
  ],
};

const CATEGORY_NAMES = Object.keys(CATEGORIES);
const ALL_SYMBOLS = CATEGORY_NAMES.flatMap((cat) => CATEGORIES[cat]);

/**
 * Tombol "Simbol" -- klik utk buka panel simbol gaya "Insert Symbol" MS
 * Word/Excel (2026-08-09, instruksi eksplisit user: kurang banyak
 * pilihannya sebelum ini), dikelompokkan per kategori + kotak cari, klik
 * simbol utk sisipkan ke field teks yang terakhir difokus (lihat
 * useActiveFieldInsert). `onMouseDown` di tiap tombol simbol SENGAJA
 * `preventDefault()` supaya fokus TIDAK pindah dari field target ke tombol
 * ini -- kalau tidak, field target jadi blur duluan sebelum simbolnya
 * sempat disisipkan ke posisi kursor yang benar.
 */
const POPUP_WIDTH = 340;

export default function SymbolPicker({ onInsert }: { onInsert: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORY_NAMES[0]);
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const visibleSymbols = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES[category];
    return ALL_SYMBOLS.filter((s) => s.label.toLowerCase().includes(q) || s.char === search.trim());
  }, [category, search]);

  // Selalu buka ke ATAS tombol (2026-08-09, instruksi eksplisit user), TIDAK
  // pernah ke bawah. Posisi dihitung dari tinggi ASLI popup (bukan estimasi)
  // lewat useLayoutEffect -- dijalankan lagi tiap kali kategori/hasil cari
  // berubah, krn jumlah baris (jadi tinggi popup) ikut berubah, supaya sisi
  // BAWAH popup tetap konsisten menempel ~6px di atas tombol.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !popupRef.current) return;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const popupHeight = popupRef.current.getBoundingClientRect().height;
    setCoords({
      top: Math.max(12, buttonRect.top - popupHeight - 6),
      left: Math.min(buttonRect.left, window.innerWidth - POPUP_WIDTH - 12),
    });
  }, [open, category, search, visibleSymbols.length]);

  // Render lewat portal ke <body> DAN posisi "fixed" berdasar koordinat layar
  // (bukan "absolute" relatif parent) -- SymbolPicker dipakai di dalam
  // `.panel` (lihat app.css: overflow-hidden), jadi popup yg lebih tinggi dari
  // sisa ruang panel akan KEPOTONG kalau cuma position:absolute biasa
  // (2026-08-09, laporan bug eksplisit user, terpotong di kartu Creating
  // Product Spek).
  return (
    <div style={{ display: "inline-block" }}>
      <button ref={buttonRef} type="button" className="btn btn-outline" onClick={() => setOpen((v) => !v)}>
        Ω° Simbol
      </button>
      {open &&
        createPortal(
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setOpen(false)} />
            <div
              ref={popupRef}
              className="panel"
              style={{
                position: "fixed",
                // Sebelum posisi terukur (render pertama tiap kali dibuka),
                // sembunyikan di luar layar dulu -- dihindari "kedip" muncul
                // sebentar di lokasi salah sebelum useLayoutEffect membetulkan
                // posisinya (berjalan sebelum browser sempat paint).
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                visibility: coords ? "visible" : "hidden",
                width: POPUP_WIDTH,
                maxHeight: "min(420px, calc(100vh - 24px))",
                zIndex: 40,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
            <input
              placeholder='Cari simbol (mis. "derajat", "omega")...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%" }}
            />
            {!search.trim() && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {CATEGORY_NAMES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setCategory(cat)}
                    className={`btn ${cat === category ? "" : "btn-outline"}`}
                    style={{ padding: "2px 8px", fontSize: "0.72rem" }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 6,
              }}
            >
              {visibleSymbols.map((s, i) => (
                <button
                  key={`${s.char}-${i}`}
                  type="button"
                  title={s.label}
                  className="btn btn-outline"
                  style={{ padding: "6px 0", fontSize: "1rem" }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onInsert(s.char)}
                >
                  {s.char}
                </button>
              ))}
              {visibleSymbols.length === 0 && (
                <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "8px 0" }}>
                  Tidak ada simbol yang cocok.
                </p>
              )}
            </div>
          </div>
          </>,
          document.body
        )}
    </div>
  );
}
