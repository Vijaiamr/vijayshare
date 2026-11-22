"use client";

/**
 * components/admin/analytics/data-table.tsx
 * Analytical data table — sortable columns, client pagination, sticky
 * header, optional CSV export. Numbers align right with tabular-nums.
 */

import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./states";

export interface Column<T> {
  key: string;
  header: string;
  /** Render cell content (defaults to row[key]). */
  cell?: (row: T) => React.ReactNode;
  /** Sort accessor (defaults to key). */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide on small screens. */
  hideBelow?: "sm" | "md" | "lg";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 10,
  initialSort,
  onRowClick,
  exportFilename,
  emptyMessage,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (row: T) => void;
  exportFilename?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const [sort, setSort] = React.useState(initialSort ?? null);
  const [page, setPage] = React.useState(0);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const accessor = col?.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key] as string | number);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(0);
  };

  const exportCsv = () => {
    if (!exportFilename || !rows.length) return;
    const header = columns.map((c) => c.header);
    const lines = rows.map((r) =>
      columns
        .map((c) => {
          const v = c.cell ? undefined : ((r as Record<string, unknown>)[c.key] as unknown);
          const raw = v === undefined ? (c.cell ? "" : (r as Record<string, unknown>)[c.key]) : v;
          const s = raw === null || raw === undefined ? "" : String(raw);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!rows.length) {
    return <EmptyState message={emptyMessage ?? "No data for the current filters."} />;
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.hideBelow === "sm" && "hidden sm:table-cell",
                    c.hideBelow === "md" && "hidden md:table-cell",
                    c.hideBelow === "lg" && "hidden lg:table-cell",
                  )}
                >
                  {c.sortValue || c.key in ((rows[0] ?? {}) as Record<string, unknown>) ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                        sort?.key === c.key && "text-foreground",
                      )}
                      aria-label={`Sort by ${c.header}`}
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  onRowClick && "cursor-pointer transition-colors hover:bg-muted/50",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5 align-middle text-foreground",
                      c.align === "right" && "text-right tabular-nums",
                      c.align === "center" && "text-center",
                      c.hideBelow === "sm" && "hidden sm:table-cell",
                      c.hideBelow === "md" && "hidden md:table-cell",
                      c.hideBelow === "lg" && "hidden lg:table-cell",
                      c.className,
                    )}
                  >
                    {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {sorted.length} row{sorted.length === 1 ? "" : "s"}
            {pageSize < sorted.length && ` · page ${safePage + 1}/${pageCount}`}
          </span>
          {exportFilename && (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Export CSV"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              CSV
            </button>
          )}
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}