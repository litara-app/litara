import { useCallback, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { icons } from "./icons";
import { ScrollRegion } from "./ScrollRegion";

type P<T> = Omit<T, "className" | "style">;

/** Dense data table. Pass `label` to wrap it in a keyboard-scrollable region. */
export function Table({ label, bordered, ...rest }: P<HTMLAttributes<HTMLTableElement>> & { label?: string; bordered?: boolean }) {
  const t = <table className="lt-table" data-bordered={bordered || undefined} {...rest} />;
  return label ? <ScrollRegion label={label}>{t}</ScrollRegion> : t;
}
export const THead = (p: P<HTMLAttributes<HTMLTableSectionElement>>) => <thead {...p} />;
export const TBody = (p: P<HTMLAttributes<HTMLTableSectionElement>>) => <tbody {...p} />;
export const TR = ({ selected, ...p }: P<HTMLAttributes<HTMLTableRowElement>> & { selected?: boolean }) => <tr data-selected={selected || undefined} {...p} />;
export const TH = ({ num, ...p }: P<ThHTMLAttributes<HTMLTableCellElement>> & { num?: boolean }) => <th data-num={num || undefined} {...p} />;
export const TD = ({ num, ...p }: P<TdHTMLAttributes<HTMLTableCellElement>> & { num?: boolean }) => <td data-num={num || undefined} {...p} />;

/* Sortable, resizable columns. The behaviour (sort state, sizing, drag) comes from TanStack Table (ADR-0083); these only draw it.
   Widths are remembered per table in this browser. */

export type ColumnWidths = Record<string, number>;
const MIN_WIDTH = 60;

function readWidths(key: string, defaults: ColumnWidths): ColumnWidths {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as ColumnWidths;
    return { ...defaults, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in defaults && Number.isFinite(v))) };
  } catch { return defaults; }
}

/** Column widths that survive a reload. `setWidths` takes a value or an updater, like React's setState. */
export function useColumnWidths(storeKey: string, defaults: ColumnWidths) {
  const [widths, setState] = useState(() => readWidths(storeKey, defaults));
  const setWidths = useCallback((next: ColumnWidths | ((prev: ColumnWidths) => ColumnWidths)) => {
    setState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      const clean = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Math.max(MIN_WIDTH, Math.round(v))]));
      try { localStorage.setItem(storeKey, JSON.stringify(clean)); } catch { /* the width is just not remembered */ }
      return clean;
    });
  }, [storeKey]);
  const reset = useCallback(() => {
    setState(defaults);
    try { localStorage.removeItem(storeKey); } catch { /* nothing remembered */ }
  }, [storeKey, defaults]);
  return { widths, setWidths, reset };
}

/** A fixed-layout table whose columns have the given widths. */
export function GridTable({ label, widths, order, children }: { label: string; widths: ColumnWidths; order: string[]; children: ReactNode }) {
  const total = order.reduce((n, id) => n + (widths[id] ?? 120), 0);
  return (
    <ScrollRegion label={label}>
      <table className="lt-table lt-grid-table" style={{ "--lt-w": `${total}px` } as CSSProperties}>
        <colgroup>{order.map((id) => <col key={id} style={{ "--lt-w": `${widths[id]}px` } as CSSProperties} />)}</colgroup>
        {children}
      </table>
    </ScrollRegion>
  );
}

export type SortOrder = "asc" | "desc";

/**
 * A column header. `sorted` and `onSort` come from the table's sort state; `onResizeStart` is the table's own drag handler
 * and `onResizeKey` receives -16 or +16 from the arrow keys.
 */
export function SortHeader({ label, sorted, onSort, onResizeStart, onResizeKey, num }: {
  label: string; sorted: SortOrder | false; onSort?: (e: React.MouseEvent) => void;
  onResizeStart?: (e: React.MouseEvent | React.TouchEvent) => void; onResizeKey?: (delta: number) => void; num?: boolean;
}) {
  const next = sorted === "asc" ? "descending" : "ascending";
  const key = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onResizeKey?.(-16); }
    if (e.key === "ArrowRight") { e.preventDefault(); onResizeKey?.(16); }
  };
  return (
    <th data-num={num || undefined} aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}>
      {onSort ? (
        <button type="button" className="lt-sort" onClick={onSort} title={`Sort ${label} ${next}`}>
          <span className="lt-sort-label">{label}</span>
          <span className="lt-sort-icon" aria-hidden="true">{sorted ? (sorted === "asc" ? icons.sortAsc : icons.sortDesc) : icons.sort}</span>
        </button>
      ) : <span className="lt-sort lt-sort-plain"><span className="lt-sort-label">{label}</span></span>}
      {onResizeStart && <button type="button" className="lt-col-resize" aria-label={`Resize ${label} column (arrow keys)`} onMouseDown={onResizeStart} onTouchStart={onResizeStart} onKeyDown={key} />}
    </th>
  );
}
