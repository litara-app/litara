import { useState, type CSSProperties } from "react";

/** One day of a heatmap: its local date (YYYY-MM-DD), the step 0-4 that sets its shade, and what it says on hover. */
export interface HeatDay { date: string; level: 0 | 1 | 2 | 3 | 4; label: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parse = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

/**
 * A contribution-style calendar: one column per week (Monday first), one shaded cell per day, in one hue from the
 * surface to the primary colour (sequential, ADR-0098). The grid is a picture; `steps` names the shades for the legend
 * and the page offers a table for keyboard and screen-reader use. Hovering a day shows its label in one readout line.
 */
export function Heatmap({ days, steps, label, empty }: { days: HeatDay[]; steps: string[]; label: string; empty: string }) {
  const [hover, setHover] = useState<HeatDay | null>(null);
  if (days.length === 0) return null;
  const lead = (parse(days[0]!.date).getDay() + 6) % 7; // blank cells before the first day, Monday = 0
  const months: { col: number; name: string }[] = [];
  days.forEach((d, i) => {
    const date = parse(d.date);
    if (date.getDate() === 1 || i === 0) months.push({ col: Math.floor((i + lead) / 7) + 1, name: MONTHS[date.getMonth()]! });
  });
  if (months.length > 1 && months[1]!.col - months[0]!.col < 3) months.shift(); // a partial first month would collide
  return (
    <figure className="lt-heat" aria-label={label}>
      <div className="lt-heat-scroll">
        <div className="lt-heat-months" aria-hidden="true">
          {months.map((m) => <span key={`${m.col}-${m.name}`} style={{ "--col": m.col } as CSSProperties}>{m.name}</span>)}
        </div>
        <div className="lt-heat-grid" aria-hidden="true" onPointerLeave={() => setHover(null)}>
          {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} className="lt-heat-pad" />)}
          {days.map((d) => (
            <span key={d.date} className="lt-heat-cell" data-level={d.level} data-testid={`heat-${d.date}`} title={d.label}
              data-hover={hover?.date === d.date || undefined} onPointerEnter={() => setHover(d)} />
          ))}
        </div>
      </div>
      <figcaption className="lt-heat-foot">
        <span className="lt-heat-readout" aria-live="polite">{hover ? hover.label : empty}</span>
        <span className="lt-heat-legend">
          <span>Less</span>
          {steps.map((s, i) => <span key={s} className="lt-heat-cell" data-level={i} title={s} aria-label={s} role="img" />)}
          <span>More</span>
        </span>
      </figcaption>
    </figure>
  );
}
