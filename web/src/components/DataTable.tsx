import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CsvColumn, exportToCsv } from "../lib/csv";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  csvValue?: (row: T) => string | number | null | undefined;
  /** Lebar awal kolom (px). Bisa diubah bebas oleh user lewat drag di header (tersimpan per tabel). */
  defaultWidth?: number;
}

interface Persisted {
  order?: string[];
  visibility?: VisibilityState;
  sizing?: ColumnSizingState;
}

function loadPersisted(storageKey: string): Persisted {
  try {
    const raw = localStorage.getItem(`flexTbl_${storageKey}`);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

/**
 * Tabel "seperti Excel": lebar kolom bisa di-drag, klik header untuk sort,
 * filter per kolom, drag header untuk pindah urutan kolom, serta
 * sembunyikan/tampilkan kolom -- semua preferensi tersimpan per tabel
 * (localStorage, key = `storageKey`) supaya tidak reset tiap buka halaman.
 */
export default function DataTable<T>({
  columns,
  rows,
  emptyMessage = "Belum ada data.",
  exportFileName,
  rowKey,
  rowStyle,
  storageKey,
  freezeFirstColumn = false,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  emptyMessage?: string;
  exportFileName?: string;
  rowKey: (row: T) => string | number;
  rowStyle?: (row: T) => CSSProperties | undefined;
  /** Wajib unik per tabel -- dipakai sbg key penyimpanan preferensi kolom. */
  storageKey: string;
  /** "Freeze" kolom PALING KIRI yg lagi tampil (ikut kolom manapun yg user pindah ke posisi
   * pertama) -- tetap kelihatan saat scroll horizontal, mirip Freeze Panes di Excel. Header
   * sudah selalu freeze ke atas (position: sticky) terlepas dari opsi ini. Default false supaya
   * tabel lain yg TIDAK secara eksplisit minta fitur ini tidak berubah tampilannya. */
  freezeFirstColumn?: boolean;
}) {
  const persisted = useMemo(() => loadPersisted(storageKey), [storageKey]);
  const defaultOrder = useMemo(() => columns.map((c) => c.key), [columns]);

  const tanColumns = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        header: c.label,
        // Dipakai TanStack utk filter (`getFilteredRowModel`) & sort -- BUKAN
        // cuma CSV export walau namanya `csvValue`. Kalau kolom tidak
        // mendefinisikan `csvValue` (paling banyak kolom teks polos spt
        // Order/Batch), SEBELUMNYA accessor-nya selalu "" apa pun isi
        // barisnya -- filter/sort di kolom itu jadi tidak pernah nemu apa-apa
        // (bug: user ketik nomor Order yg jelas ada, hasil filter kosong).
        // Fallback ke hasil `render()` kalau berupa string/number polos
        // (kasus paling umum) -- kolom yg render-nya JSX kompleks (badge,
        // tombol Aksi) sudah SELALU py `csvValue` eksplisit di semua
        // pemanggil, jadi tidak kena cabang fallback ini.
        accessorFn: (row: T) => {
          if (c.csvValue) return c.csvValue(row) ?? "";
          const rendered = c.render(row);
          return typeof rendered === "string" || typeof rendered === "number" ? rendered : "";
        },
        cell: (info) => c.render(info.row.original),
        size: c.defaultWidth ?? 170,
        minSize: 60,
        maxSize: 640,
      })),
    [columns]
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(persisted.visibility ?? {});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    persisted.order && persisted.order.length === defaultOrder.length ? persisted.order : defaultOrder
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(persisted.sizing ?? {});
  const [showFilters, setShowFilters] = useState(false);
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(
      `flexTbl_${storageKey}`,
      JSON.stringify({ order: columnOrder, visibility: columnVisibility, sizing: columnSizing })
    );
  }, [storageKey, columnOrder, columnVisibility, columnSizing]);

  const table = useReactTable({
    data: rows,
    columns: tanColumns,
    state: { sorting, columnFilters, columnVisibility, columnOrder, columnSizing },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function resetColumns() {
    localStorage.removeItem(`flexTbl_${storageKey}`);
    setColumnVisibility({});
    setColumnOrder(defaultOrder);
    setColumnSizing({});
    setColumnFilters([]);
    setSorting([]);
  }

  // Kanvas offscreen dipakai cuma utk `measureText` (bukan ditampilkan) --
  // dibuat sekali & disimpan di ref supaya double-click autofit berikutnya
  // tidak bikin elemen baru tiap kali.
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Tabel History/Master Data bisa berisi ratusan-ribuan baris (hasil import
  // CSV) -- autofit tetap akurat utk mayoritas kasus walau cuma mengukur N
  // baris pertama (variasi panjang teks per kolom biasanya kecil), jauh lebih
  // cepat drpd mengukur semua baris sekaligus.
  const AUTOFIT_SAMPLE_LIMIT = 3000;
  const AUTOFIT_PADDING = 32;

  /** Lebar kolom "pas isi" (dobel klik strip resize) -- mirip autofit lebar
   * kolom di Excel. Dihitung dari lebar teks TERPANJANG (label header +
   * isi kolom, pakai csvValue kalau ada spy konsisten dgn kolom yg cell-nya
   * JSX/badge, sama pola dgn accessorFn di atas) via Canvas measureText,
   * bukan dari DOM langsung -- supaya baris yg lagi di luar viewport
   * (virtualized, belum ke-render ke DOM) tetap ikut terhitung. */
  function autoFitColumn(columnId: string) {
    const original = columns.find((c) => c.key === columnId);
    if (!original) return;
    if (!measureCanvasRef.current) measureCanvasRef.current = document.createElement("canvas");
    const ctx = measureCanvasRef.current.getContext("2d");
    if (!ctx) return;
    const sampleCell = scrollRef.current?.querySelector("td, th");
    ctx.font = sampleCell ? getComputedStyle(sampleCell).font : "13px sans-serif";

    let maxWidth = ctx.measureText(original.label).width;
    const sample = rows.length > AUTOFIT_SAMPLE_LIMIT ? rows.slice(0, AUTOFIT_SAMPLE_LIMIT) : rows;
    for (const row of sample) {
      let value: unknown;
      if (original.csvValue) {
        value = original.csvValue(row);
      } else {
        const rendered = original.render(row);
        value = typeof rendered === "string" || typeof rendered === "number" ? rendered : "";
      }
      if (value == null || value === "") continue;
      const w = ctx.measureText(String(value)).width;
      if (w > maxWidth) maxWidth = w;
    }

    const columnDef = table.getColumn(columnId)?.columnDef;
    const minSize = columnDef?.minSize ?? 60;
    const maxSize = columnDef?.maxSize ?? 640;
    const fitted = Math.min(maxSize, Math.max(minSize, Math.ceil(maxWidth + AUTOFIT_PADDING)));
    setColumnSizing((old) => ({ ...old, [columnId]: fitted }));
  }

  function handleDrop(targetColId: string) {
    if (!draggedCol || draggedCol === targetColId) return;
    setColumnOrder((old) => {
      const next = [...old];
      const from = next.indexOf(draggedCol);
      const to = next.indexOf(targetColId);
      if (from === -1 || to === -1) return old;
      next.splice(from, 1);
      next.splice(to, 0, draggedCol);
      return next;
    });
    setDraggedCol(null);
  }

  const csvColumns: CsvColumn<T>[] = table.getVisibleLeafColumns().map((col) => {
    const original = columns.find((c) => c.key === col.id)!;
    return { label: original.label, value: original.csvValue ?? ((row) => String(original.render(row) ?? "")) };
  });

  const visibleCount = table.getVisibleLeafColumns().length;

  // Virtualisasi baris -- cuma <tr> yg kelihatan (+ overscan) yg benar2
  // dirender ke DOM, sisanya diwakili 2 baris "spacer" (padding atas/bawah)
  // supaya browser tidak perlu bikin ribuan elemen sekaligus utk tabel History
  // yg baris-nya bisa ratusan-ribuan (hasil import CSV) -- sebelumnya SEMUA
  // baris langsung dirender, bikin lemot. Teknik spacer-row dipilih (bukan
  // absolute-position per baris) supaya <table> asli + sticky header + freeze
  // kolom pertama + resize/drag kolom yg sudah ada TETAP jalan apa adanya.
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    // Tinggi baris bisa beda2 (mis. Remark panjang yg wrap ke beberapa baris,
    // lihat `word-break`/`overflow-wrap` di table.data-table td pada
    // app.css) -- estimateSize cuma tebakan awal, tinggi asli tiap baris
    // diukur ulang via `measureElement` (ref di setiap <tr>) di bawah.
    estimateSize: () => 37,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button className={`btn ${showFilters ? "" : "btn-outline"}`} type="button" onClick={() => setShowFilters((s) => !s)}>
            🔍 Filter
          </button>
          <div style={{ position: "relative" }}>
            <button className={`btn ${showColumnPanel ? "" : "btn-outline"}`} type="button" onClick={() => setShowColumnPanel((s) => !s)}>
              ☰ Kolom
            </button>
            {showColumnPanel && (
              <div
                className="panel"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 20,
                  minWidth: 220,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: 10,
                }}
              >
                {table.getAllLeafColumns().map((col) => (
                  <label key={col.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontSize: "0.85rem" }}>
                    <input type="checkbox" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} />
                    {String(col.columnDef.header)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-outline" type="button" onClick={resetColumns}>
            ↺ Reset Kolom
          </button>
        </div>
        {exportFileName && (
          <button className="btn btn-outline" onClick={() => exportToCsv(exportFileName, csvColumns, rows)} disabled={rows.length === 0}>
            ⭳ Export CSV
          </button>
        )}
      </div>

      {/*
        Scroll container dibatasi tinggi (max-h) supaya scrollbar horizontal
        SELALU kelihatan tanpa harus scroll ke baris paling bawah dulu --
        mirip Excel yg header + scrollbar tetap "nempel" walau datanya banyak.
        Header dibuat sticky (position: sticky di tiap <th>) supaya ikut
        nempel di atas saat scroll vertikal.
      */}
      <div ref={scrollRef} className="overflow-auto rounded-lg border border-slate-200 max-h-[70vh]">
        <table className="data-table" style={{ width: table.getTotalSize(), tableLayout: "fixed" }}>
          <thead>
            <tr>
              {table.getHeaderGroups()[0].headers.map((header, headerIdx) => {
                const isFrozen = freezeFirstColumn && headerIdx === 0;
                return (
                <th
                  key={header.id}
                  style={{
                    width: header.getSize(),
                    position: "sticky",
                    top: 0,
                    left: isFrozen ? 0 : undefined,
                    zIndex: isFrozen ? 3 : 2,
                    userSelect: "none",
                    boxShadow: isFrozen ? "2px 0 4px -2px rgba(0,0,0,0.15)" : undefined,
                  }}
                  draggable
                  onDragStart={() => setDraggedCol(header.column.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(header.column.id)}
                >
                  <div
                    style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, paddingRight: 8 }}
                    onClick={header.column.getToggleSortingHandler()}
                    title="Klik utk sort, drag utk pindah kolom"
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    <span style={{ fontSize: "0.7rem" }}>
                      {{ asc: "▲", desc: "▼" }[header.column.getIsSorted() as string] ?? ""}
                    </span>
                  </div>
                  {showFilters && (
                    <input
                      value={(header.column.getFilterValue() as string) ?? ""}
                      onChange={(e) => header.column.setFilterValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Filter..."
                      style={{ width: "100%", marginTop: 4, fontSize: "0.75rem", padding: "2px 4px" }}
                    />
                  )}
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      autoFitColumn(header.column.id);
                    }}
                    title="Drag utk ubah lebar, dobel klik utk pas-kan otomatis ke isi kolom"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      height: "100%",
                      width: 6,
                      cursor: "col-resize",
                      touchAction: "none",
                      background: header.column.getIsResizing() ? "#4f46e5" : "transparent",
                    }}
                  />
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={visibleCount} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = tableRows[virtualRow.index];
              const explicitBg = rowStyle?.(row.original)?.background as string | undefined;
              const zebraBg = virtualRow.index % 2 === 1 ? "#f8fafc" : "#ffffff";
              return (
                <tr
                  key={rowKey(row.original)}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={rowStyle?.(row.original)}
                >
                  {row.getVisibleCells().map((cell, cellIdx) => {
                    const isFrozen = freezeFirstColumn && cellIdx === 0;
                    return (
                      <td
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          ...(isFrozen
                            ? {
                                position: "sticky",
                                left: 0,
                                zIndex: 1,
                                background: explicitBg ?? zebraBg,
                                boxShadow: "2px 0 4px -2px rgba(0,0,0,0.15)",
                              }
                            : undefined),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={visibleCount} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleCount} className="py-8 text-center text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
