import type { ReactNode } from "react";

export interface TimelineItem { key: string; title: ReactNode; meta?: ReactNode; tone?: "success" | "info" | "neutral" | "warning"; body?: ReactNode }

/** Events in time order, newest first. A list, so screen readers count the entries. */
export function Timeline({ label, items }: { label: string; items: TimelineItem[] }) {
  return (
    <ol className="lt-timeline" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="lt-tl-item" data-tone={i.tone ?? "neutral"}>
          <div className="lt-tl-title">{i.title}</div>
          {i.meta && <div className="lt-tl-meta">{i.meta}</div>}
          {i.body}
        </li>
      ))}
    </ol>
  );
}
