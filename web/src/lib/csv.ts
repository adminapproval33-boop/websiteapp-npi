export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

/** Export ke CSV (dgn BOM UTF-8 supaya kolom berbahasa Indonesia rapi dibuka di Excel), meniru downloadCsv_ di versi lama. */
export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(",")).join("\n");
  const csv = "﻿" + [header, body].filter(Boolean).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
