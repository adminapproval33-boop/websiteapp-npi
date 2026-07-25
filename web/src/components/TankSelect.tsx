import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useTankOptions() {
  return useQuery({
    queryKey: ["master-tanks"],
    queryFn: () => api.get<{ success: boolean; data: string[] }>("/master-data/tanks").then((r) => r.data),
    staleTime: 60_000,
  });
}

export default function TankSelect({
  value,
  onChange,
  id,
  required = true,
  bare = false,
  label = "Code Tanki",
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
}) {
  const { data: tanks } = useTankOptions();
  const listId = `${id}-tank-options`;

  const input = (
    <>
      <input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      <datalist id={listId}>
        {(tanks ?? []).map((code) => (
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
