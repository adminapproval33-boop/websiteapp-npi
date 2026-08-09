/** Utk spec BUKAN rentang (<=, >=, <, >, exact) verdict cuma OK/NG polos. Utk spec
 * RENTANG ("lo-hi"), rentang OK-nya dibagi 3 sepertiga sama besar (Lower/Center/Upper)
 * supaya user bisa lihat hasil condong ke batas bawah/tengah/atas spec, bukan cuma OK. */
export type SpecVerdict = "ok" | "ok-lower" | "ok-center" | "ok-upper" | "ng" | "unknown";

export const SPEC_VERDICT_LABEL: Record<SpecVerdict, string> = {
  ok: "OK",
  "ok-lower": "OK Lower",
  "ok-center": "OK Center",
  "ok-upper": "OK Upper",
  ng: "NG",
  unknown: "-",
};

/** Skala kekerasan pensil (pencil hardness), dari paling lunak ke paling
 * keras -- 4H = paling keras/tinggi (2026-08-09, instruksi eksplisit user).
 * Dipakai KHUSUS kalau Item Check mengandung kata "HARDNESS": Result OK
 * kalau kekerasannya >= Spec (mis. Spec "HB" -> HB/F/H/2H/3H/4H = OK,
 * B/2B/3B/4B = NG), bukan dibandingkan sbg angka spt spec lain. */
const HARDNESS_RANK: Record<string, number> = {
  "4B": 0,
  "3B": 1,
  "2B": 2,
  B: 3,
  HB: 4,
  F: 5,
  H: 6,
  "2H": 7,
  "3H": 8,
  "4H": 9,
};

/** Ambil token grade kekerasan (mis. "HB", "2H") dari sebuah teks bebas --
 * teks dipecah per token non-alfanumerik supaya spec spt "Min HB" tetap
 * ketemu "HB", bukan cuma exact match string utuh. */
function parseHardnessRank(text: string): number | null {
  const tokens = text.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  for (const token of tokens) {
    if (token in HARDNESS_RANK) return HARDNESS_RANK[token];
  }
  return null;
}

// Diurutkan PANJANG-KE-PENDEK ("HB" sebelum "B", "4H" sebelum "H") supaya
// alternation regex di bawah tidak berhenti di token pendek yg salah duluan.
const HARDNESS_TOKEN_ALT = Object.keys(HARDNESS_RANK)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Ganti simbol ≤/≥ (bisa diketik lewat Symbol Picker) jadi <=/>= ASCII
 * biasa supaya bisa dicocokkan 1 pola regex yang sama. */
function normalizeComparisonSymbols(text: string): string {
  return text.replace(/≤/g, "<=").replace(/≥/g, ">=");
}

/** Evaluasi spec HARDNESS yang EKSPLISIT rentang ("B-H") atau pakai
 * pembanding ("<=HB", ">=HB", ≤HB/≥HB, "<H", ">B") -- 2026-08-09, instruksi
 * eksplisit user (celah yg ditemukan: sebelumnya "B-H" cuma kebaca sbg
 * token pertama "B" doang, upper bound "H"-nya diabaikan; dan "≤HB"
 * simbolnya ikut diabaikan begitu saja lewat split-token, jadi arah
 * pembandingnya kebalik jadi ">="). Return null kalau spec BUKAN salah satu
 * pola eksplisit ini, supaya caller fallback ke pola lama "cari token
 * pertama di teks bebas, anggap minimal segitu" (mis. spec "HB OR MORE"). */
function evaluateHardnessStructured(specTrim: string, resultRank: number): SpecVerdict | null {
  const spec = normalizeComparisonSymbols(specTrim.toUpperCase());
  const tok = `(${HARDNESS_TOKEN_ALT})`;
  let m: RegExpMatchArray | null;
  if ((m = spec.match(new RegExp(`^${tok}\\s*-\\s*${tok}$`)))) {
    const a = HARDNESS_RANK[m[1]];
    const b = HARDNESS_RANK[m[2]];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return resultRank >= lo && resultRank <= hi ? "ok" : "ng";
  }
  if ((m = spec.match(new RegExp(`^<=\\s*${tok}$`)))) return resultRank <= HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^>=\\s*${tok}$`)))) return resultRank >= HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^<\\s*${tok}$`)))) return resultRank < HARDNESS_RANK[m[1]] ? "ok" : "ng";
  if ((m = spec.match(new RegExp(`^>\\s*${tok}$`)))) return resultRank > HARDNESS_RANK[m[1]] ? "ok" : "ng";
  return null;
}

/**
 * Evaluasi hasil cek terhadap string spesifikasi, mis. "40-45" (rentang),
 * "<=28", ">=10", "<5", ">5", atau angka tunggal (exact match).
 * Meniru logika pass/fail auto-coloring di versi Apps Script, ditambah pembagian
 * Lower/Center/Upper khusus utk spec rentang. `itemCheck` opsional -- kalau
 * mengandung kata "HARDNESS", dibandingkan pakai skala pensil (lihat
 * HARDNESS_RANK) alih-alih pola numerik/rentang biasa di bawah.
 */
export function evaluateSpec(
  spec: string | null | undefined,
  result: string | null | undefined,
  itemCheck?: string | null
): SpecVerdict {
  const specTrim = String(spec ?? "").trim();
  const resultTrim = String(result ?? "").trim();
  if (!specTrim) return "unknown";

  if (String(itemCheck ?? "").toUpperCase().includes("HARDNESS")) {
    const resultRank = parseHardnessRank(resultTrim);
    if (resultRank !== null) {
      const structured = evaluateHardnessStructured(specTrim, resultRank);
      if (structured !== null) return structured;
      const specRank = parseHardnessRank(specTrim);
      if (specRank !== null) return resultRank >= specRank ? "ok" : "ng";
    }
  }

  // Spec tekstual "OK" (mis. Item Check Appearance/visual yg bukan angka) --
  // Result dibandingkan sbg teks "OK"/"NG" langsung, bukan diparse jadi angka
  // (2026-08-05, instruksi eksplisit user).
  if (specTrim.toUpperCase() === "OK") {
    const resultUpper = resultTrim.toUpperCase();
    if (resultUpper === "OK") return "ok";
    if (resultUpper === "NG") return "ng";
    return "unknown";
  }

  const resultNum = parseFloat(resultTrim);
  if (Number.isNaN(resultNum)) return "unknown";

  // Normalisasi ≤/≥ (bisa diketik lewat Symbol Picker) jadi <=/>= ASCII
  // biasa (2026-08-09, instruksi eksplisit user) -- SEBELUM ini, "≥10"
  // selalu balik "unknown" krn regex di bawah cuma cocok ">=" ASCII, bukan
  // simbol Unicode-nya.
  const specNormalized = normalizeComparisonSymbols(specTrim);
  const num = "(-?\\d+(?:\\.\\d+)?)";
  let m: RegExpMatchArray | null;

  if ((m = specNormalized.match(new RegExp(`^${num}\\s*-\\s*${num}$`)))) {
    return evaluateNumericRange(resultNum, parseFloat(m[1]), parseFloat(m[2]));
  }
  // "40 ±10" / "40±10" -- notasi toleransi (tengah ± simpangan), setara
  // rentang [tengah-simpangan, tengah+simpangan] (2026-08-09, instruksi
  // eksplisit user), pakai pembagian Lower/Center/Upper yg sama spt rentang
  // "lo-hi" biasa.
  if ((m = specNormalized.match(new RegExp(`^${num}\\s*±\\s*${num}$`)))) {
    const center = parseFloat(m[1]);
    const tolerance = Math.abs(parseFloat(m[2]));
    return evaluateNumericRange(resultNum, center - tolerance, center + tolerance);
  }
  if ((m = specNormalized.match(new RegExp(`^<=\\s*${num}$`)))) return resultNum <= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^>=\\s*${num}$`)))) return resultNum >= parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^<\\s*${num}$`)))) return resultNum < parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^>\\s*${num}$`)))) return resultNum > parseFloat(m[1]) ? "ok" : "ng";
  if ((m = specNormalized.match(new RegExp(`^=?\\s*${num}$`)))) return resultNum === parseFloat(m[1]) ? "ok" : "ng";

  return "unknown";
}

/** Bagi rentang [lo,hi] jadi 3 sepertiga sama besar (Lower/Center/Upper) --
 * dipakai bareng oleh pola rentang "lo-hi" & pola toleransi "tengah±simpangan"
 * (2026-08-09, instruksi eksplisit user) supaya perilakunya konsisten. */
function evaluateNumericRange(resultNum: number, a: number, b: number): SpecVerdict {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (resultNum < lo || resultNum > hi) return "ng";
  const third = (hi - lo) / 3;
  const lowerBound = lo + third;
  const upperBound = hi - third;
  if (resultNum < lowerBound) return "ok-lower";
  if (resultNum > upperBound) return "ok-upper";
  return "ok-center";
}

/**
 * Cek APAKAH teks Spec ini sudah dalam format yang bisa diproses evaluateSpec
 * (2026-08-09, instruksi eksplisit user) -- dipakai di menu Creating Product
 * Spek utk mengoreksi ketikan admin di kolom Spec SEBELUM dipakai QC di Check
 * Results (di situ TIDAK ada Result asli, cuma Spec, jadi validasinya murni
 * soal formatnya saja). Caranya: coba evaluasi pakai Result "boneka" yang
 * pasti valid utk tipe spec-nya (angka polos utk numerik/rentang, token
 * grade utk HARDNESS, teks "OK" utk spec literal "OK") -- SATU-SATUNYA yg
 * menentukan hasilnya adalah Spec-nya sendiri, boneka itu cuma pemicu supaya
 * evaluateSpec mau coba parsing spec-nya.
 */
export function isSpecFormatValid(spec: string | null | undefined, itemCheck?: string | null): boolean {
  const specTrim = String(spec ?? "").trim();
  if (!specTrim) return false;
  const dummyResult = String(itemCheck ?? "").toUpperCase().includes("HARDNESS")
    ? "HB"
    : specTrim.toUpperCase() === "OK"
      ? "OK"
      : "0";
  return evaluateSpec(specTrim, dummyResult, itemCheck) !== "unknown";
}

const SUGGEST_NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * Coba saranin perbaikan teks Spec yang "Invalid" (2026-08-09, instruksi
 * eksplisit user) -- dipakai nampilin tombol bantuan di kolom Verdict
 * Creating Product Spek. Cuma jalan kalau Spec-nya MEMANG tidak valid
 * (`isSpecFormatValid` false); null kalau sudah valid atau tidak ada saran
 * yang aman ditawarkan (mis. Item Check HARDNESS dgn teks yg sama sekali
 * tidak mengandung grade dikenal -- menebak grade sembarangan berisiko
 * salah, jadi sengaja tidak disarankan apa-apa).
 *
 * Dua pola yang dikenali:
 * 1. "lo < X < hi" (mis. "29.49 < L < 31.49") -> disarankan jadi rentang
 *    "lo-hi" yg didukung evaluateSpec.
 * 2. Pola rentang/pembanding yang valid tapi "terselip" di antara teks lain
 *    (mis. "40-45 KU" atau ">=10 pcs") -> disarankan buang teks tambahannya,
 *    sisakan cuma bagian yang dikenal ("40-45" / ">=10").
 */
export function suggestValidSpec(spec: string | null | undefined, itemCheck?: string | null): string | null {
  const specTrim = String(spec ?? "").trim();
  if (!specTrim || isSpecFormatValid(specTrim, itemCheck)) return null;
  if (String(itemCheck ?? "").toUpperCase().includes("HARDNESS")) return null;

  const normalized = normalizeComparisonSymbols(specTrim);

  let m = normalized.match(new RegExp(`^${SUGGEST_NUM}\\s*<\\s*\\S+\\s*<\\s*${SUGGEST_NUM}$`));
  if (m) {
    const lo = Math.min(parseFloat(m[1]), parseFloat(m[2]));
    const hi = Math.max(parseFloat(m[1]), parseFloat(m[2]));
    return `${lo}-${hi}`;
  }

  m = normalized.match(new RegExp(`${SUGGEST_NUM}\\s*-\\s*${SUGGEST_NUM}`));
  if (m) return m[0];

  m = normalized.match(new RegExp(`${SUGGEST_NUM}\\s*±\\s*${SUGGEST_NUM}`));
  if (m) return m[0];

  m = normalized.match(new RegExp(`(<=|>=|<|>|=)\\s*${SUGGEST_NUM}`));
  if (m) return m[0];

  if (/\bOK\b/i.test(specTrim)) return "OK";

  return null;
}

export const SPEC_VERDICT_COLOR: Record<SpecVerdict, string> = {
  ok: "#d4f4dd",
  "ok-lower": "#d4f4dd",
  "ok-center": "#d4f4dd",
  "ok-upper": "#d4f4dd",
  ng: "#fbd6d6",
  unknown: "transparent",
};
