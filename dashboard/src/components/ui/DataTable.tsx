import { useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: string;
  render: (item: T) => ReactNode;
  sortValue?: (item: T) => number | string;
  mobileLabel?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (item: T) => string;
  onRowClick?: (item: T) => void;
  className?: string;
}

export function DataTable<T>({ columns, data, keyFn, onRowClick, className = "" }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = (() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  })();

  return (
    <>
      {/* Desktop table */}
      <div className={`hidden md:block bg-surface rounded-lg border border-border overflow-hidden ${className}`}>
        <table className="w-full text-sm" style={columns.some((c) => c.width) ? { tableLayout: "fixed" } : undefined}>
          <thead>
            <tr className="border-b border-border text-muted text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-md py-sm font-medium ${col.align === "right" ? "text-right" : ""} ${
                    col.sortValue ? "cursor-pointer hover:text-secondary select-none" : ""
                  }`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortValue ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-xs">
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-accent">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={keyFn(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={`border-b border-border-subtle hover:bg-surface-hover transition-colors duration-short ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-md py-sm ${col.align === "right" ? "text-right" : ""}`} style={col.width ? { width: col.width } : undefined}>
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className={`md:hidden space-y-sm ${className}`}>
        {sorted.map((item) => (
          <div
            key={keyFn(item)}
            onClick={onRowClick ? () => onRowClick(item) : undefined}
            className={`bg-surface rounded-md border border-border p-md space-y-xs ${
              onRowClick ? "cursor-pointer active:bg-surface-hover" : ""
            }`}
          >
            {columns.map((col) => (
              <div key={col.key} className="flex items-center justify-between">
                <span className="text-xs text-muted">{col.mobileLabel ?? col.label}</span>
                <span className={`text-sm ${col.align === "right" ? "tabular-nums" : ""}`}>
                  {col.render(item)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
