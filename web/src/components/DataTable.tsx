import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
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
        accessorFn: (row: T) => (c.csvValue ? c.csvValue(row) : "") ?? "",
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
      <div className="overflow-auto rounded-lg border border-slate-200 max-h-[70vh]">
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
            {table.getRowModel().rows.map((row, rowIdx) => {
              const explicitBg = rowStyle?.(row.original)?.background as string | undefined;
              const zebraBg = rowIdx % 2 === 1 ? "#f8fafc" : "#ffffff";
              return (
                <tr key={rowKey(row.original)} style={rowStyle?.(row.original)}>
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
