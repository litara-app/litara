import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

/** The page's scroll container (the main area), which is what long lists scroll inside. */
const scroller = () => document.querySelector<HTMLElement>(".lt-main");

/** How far down the scroller the element starts, so a list that begins below a header still lines up (ADR-0084). */
function useMargin(anchor: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const a = anchor.current, s = scroller();
    if (!a || !s) return;
    const measure = () => setMargin(Math.round(a.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return margin;
}

/** Fixed-height rows: returns the rows to draw and the empty space above and below them. */
export function useVirtualRows(count: number, rowHeight: number, anchor: RefObject<HTMLElement | null>) {
  const margin = useMargin(anchor, [count]);
  const v = useVirtualizer({ count, getScrollElement: scroller, estimateSize: () => rowHeight, overscan: 10, scrollMargin: margin });
  // Before the first measurement (and where there is no layout, as in tests) draw the first rows instead of nothing.
  const measured = v.getVirtualItems();
  const items = measured.length > 0 ? measured : Array.from({ length: Math.min(count, FALLBACK_ROWS) }, (_, index) => ({ index }));
  const top = measured.length ? measured[0]!.start - margin : 0;
  const bottom = measured.length ? Math.max(0, v.getTotalSize() - (measured[measured.length - 1]!.end - margin)) : 0;
  return { items, top, bottom };
}

/** An empty table row that stands in for the rows that are not drawn. */
export function VirtualPad({ height, columns }: { height: number; columns: number }) {
  if (height <= 0) return null;
  return <tr className="lt-vpad" aria-hidden="true" style={{ "--lt-h": `${height}px` } as CSSProperties}><td colSpan={columns} /></tr>;
}

/**
 * A list of rows whose heights differ, drawing only those near the viewport and measuring each one (ADR-0084). Each row
 * carries its place in the whole list for people who cannot see that the list is only partly drawn.
 */
export function VirtualList<T>({ items, estimate, getKey, render }: { items: T[]; estimate: number; getKey: (item: T) => string; render: (item: T, index: number) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const margin = useMargin(host, [items.length]);
  const v = useVirtualizer({
    count: items.length, getScrollElement: scroller, estimateSize: () => estimate, overscan: 10, scrollMargin: margin,
    // Measured heights follow the item when the order changes.
    getItemKey: (index) => (items[index] === undefined ? index : getKey(items[index]!)),
  });
  const measured = v.getVirtualItems();
  const virtual = measured.length > 0 ? measured : Array.from({ length: Math.min(items.length, FALLBACK_ROWS) }, (_, index) => ({ index }));
  const top = measured.length ? measured[0]!.start - margin : 0;
  const bottom = measured.length ? Math.max(0, v.getTotalSize() - (measured[measured.length - 1]!.end - margin)) : 0;
  return (
    <div ref={host} className="lt-vlist" role="list" style={{ "--lt-top": `${top}px`, "--lt-bottom": `${bottom}px` } as CSSProperties}>
      {virtual.map(({ index }) => {
        const item = items[index];
        if (item === undefined) return null; // the list just got shorter
        return (
          <div key={getKey(item)} ref={v.measureElement} data-index={index} className="lt-vlist-row" role="listitem" aria-posinset={index + 1} aria-setsize={items.length}>
            {render(item, index)}
          </div>
        );
      })}
    </div>
  );
}

const GAP = 16;
const FALLBACK_ROWS = 40;

/**
 * A grid of equal tiles that only draws the rows near the viewport. The column count follows the container width the way
 * an auto-fill grid would, so the layout matches the non-virtual one.
 */
export function VirtualGrid<T>({ items, minWidth, render, getKey }: { items: T[]; minWidth: number; render: (item: T) => ReactNode; getKey: (item: T) => string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((width + GAP) / (minWidth + GAP)));
  const rows = Math.ceil(items.length / cols);
  const tile = cols > 0 && width > 0 ? (width - GAP * (cols - 1)) / cols : minWidth;
  const margin = useMargin(host, [rows, cols]);
  const v = useVirtualizer({ count: rows, getScrollElement: scroller, estimateSize: () => Math.round(tile * 1.5) + GAP, overscan: 3, scrollMargin: margin });
  const measured = v.getVirtualItems();
  const virtual = measured.length > 0 ? measured : Array.from({ length: Math.min(rows, 6) }, (_, index) => ({ index }));
  const top = measured.length ? measured[0]!.start - margin : 0;
  const bottom = measured.length ? Math.max(0, v.getTotalSize() - (measured[measured.length - 1]!.end - margin)) : 0;
  return (
    <div ref={host} className="lt-vgrid" data-testid="covers-grid" style={{ "--lt-top": `${top}px`, "--lt-bottom": `${bottom}px`, "--lt-cols": cols } as CSSProperties}>
      {virtual.map((row) => (
        <div key={row.index} ref={v.measureElement} data-index={row.index} className="lt-vgrid-row">
          {items.slice(row.index * cols, row.index * cols + cols).map((it) => <div key={getKey(it)}>{render(it)}</div>)}
        </div>
      ))}
    </div>
  );
}
