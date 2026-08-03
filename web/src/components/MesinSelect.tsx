import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useMesinOptions() {
  return useQuery({
    queryKey: ["master-mesin"],
    queryFn: () => api.get<{ success: boolean; data: string[] }>("/master-data/mesin").then((r) => r.data),
    staleTime: 60_000,
  });
}

/**
 * Field Code Mesin (2026-08-02, instruksi eksplisit user) -- listnya ikut
 * Master Data Mesin (sama sumber dgn Dashboard > Mesin Monitoring), otomatis
 * nambah begitu ada Code Mesin baru lewat tombol "+Code Mesin", TANPA perlu
 * ubah kode di sini.
 *
 * SEMPAT jadi <select> tegas (tidak bisa ketik bebas) supaya menghindari
 * typo (kasus nyata "DYNO MILL 21" vs "DYNO MILL 21 - RISET", 2 mesin beda
 * kode nyaris sama) -- tapi DIREVISI 2026-08-02 (instruksi eksplisit user)
 * balik ke <input list> + <datalist> (sama pola dgn TankSelect/Code Tanki)
 * krn scroll di 36+ opsi dropdown polos dirasa lambat, sedangkan datalist
 * bisa diketik utk memfilter cepat (mis. ketik "01" -> semua mesin yg ada
 * "01", ketik "dyno" -> semua DYNO MILL) SAMBIL tetap nunjukin saran dari
 * daftar resmi. Trade-off: datalist TIDAK memaksa nilai akhirnya persis
 * salah satu opsi (beda dari <select>) -- typo tetap mungkin kalau user
 * ketik manual tanpa klik salah satu saran.
 */
export default function MesinSelect({
  value,
  onChange,
  onBlur,
  id,
  required = true,
  bare = false,
  label = "Code Mesin",
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
}) {
  const { data: mesinList } = useMesinOptions();
  const listId = `${id}-mesin-options`;

  const input = (
    <>
      <input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} required={required} />
      <datalist id={listId}>
        {(mesinList ?? []).map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </>
  );

  if (bare) return input;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
}
