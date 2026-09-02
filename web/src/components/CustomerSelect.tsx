import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Nama Customer yang sudah pernah diinput di Check Results (2026-09-02,
 * instruksi eksplisit user: kolom Customer selama ini teks bebas jadi
 * berantakan -- 170 varian teks utk ~135 perusahaan sungguhan). Dipakai sbg
 * saran <datalist> di CustomerSelect di bawah supaya admin bisa PILIH nama
 * yang sudah ada (di Check Results maupun Approval), bukan ketik ulang dari
 * nol tiap kali -- mengurangi variasi ejaan baru ke depannya.
 */
export function useCustomerSuggestions() {
  return useQuery({
    queryKey: ["check-results-customer-suggestions"],
    queryFn: () => api.get<{ success: boolean; data: string[] }>("/check-results/customer-suggestions").then((r) => r.data),
    staleTime: 60_000,
  });
}

/**
 * Input Customer dgn saran <datalist> (pola sama dgn IuPlantSelect) --
 * TETAP bisa diketik bebas (mis. customer baru yang belum pernah tercatat),
 * tapi begitu admin mulai ketik, browser menyodorkan nama yang sudah pernah
 * dipakai supaya tidak perlu ketik ulang dari nol / ada variasi ejaan baru.
 */
export default function CustomerSelect({
  value,
  onChange,
  id,
  required = false,
  bare = false,
  label = "Customer",
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
}) {
  const { data: suggestions } = useCustomerSuggestions();
  const listId = `${id}-options`;

  const input = (
    <>
      <input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} required={required} autoComplete="off" />
      <datalist id={listId}>
        {(suggestions ?? []).map((name) => (
          <option key={name} value={name} />
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
