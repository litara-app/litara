import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { Cover } from "./feedback";
import { IconAction } from "./controls";
import { icons } from "./icons";

/* The author and series pieces (ADR-0104): portraits on cabinet cards, fanned series covers and the shelf rail. */

/** Up to three initials, which stand in for a photo the author does not have. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => [...w][0]!.toUpperCase()).join("");
}

function Mount({ name, photo, children }: { name: string; photo?: string | null; children?: ReactNode }) {
  return (
    <>
      <span className="lt-mount-corner" data-at="tl" aria-hidden="true" /><span className="lt-mount-corner" data-at="tr" aria-hidden="true" />
      <span className="lt-mount-corner" data-at="bl" aria-hidden="true" /><span className="lt-mount-corner" data-at="br" aria-hidden="true" />
      <span className="lt-mount-arch" aria-hidden="true">{photo ? <img src={photo} alt="" loading="lazy" /> : <span>{initials(name)}</span>}</span>
      {children}
    </>
  );
}

/** An author in the directory. The ribbon with the book count drops on hover or focus, and always shows on touch screens. */
export function AuthorCard({ to, name, books, detail, photo, testId }: {
  to: string; name: string; books: number; detail: string; photo?: string | null; testId?: string;
}) {
  return (
    <Link to={to} className="lt-mount" data-testid={testId}>
      <Mount name={name} photo={photo}>
        <span className="lt-mount-name">{name}</span>
        <span className="lt-mount-detail">{detail}</span>
        <span className="lt-mount-ribbon"><strong>{books}</strong><span>{books === 1 ? "book" : "books"}</span></span>
      </Mount>
    </Link>
  );
}

/** The large portrait on an author's page. `editTo` adds the hover control that opens the author's edit tab. */
export function Portrait({ name, photo, editTo }: { name: string; photo?: string | null; editTo?: string }) {
  return (
    <div className="lt-portrait">
      <div className="lt-mount" data-static role="img" aria-label={photo ? `Photo of ${name}` : `No photo of ${name}`}>
        <Mount name={name} photo={photo}><span className="lt-mount-name" aria-hidden="true">{name}</span></Mount>
      </div>
      {editTo && <span className="lt-portrait-edit"><IconAction label="Edit author and photo" icon={icons.pencil} to={editTo} /></span>}
    </div>
  );
}

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** The A to Z row above the authors. A letter nobody is filed under cannot be chosen; the chosen one stays enabled. */
export function LetterRail({ label, available, value, onValue }: { label: string; available: string[]; value: string; onValue: (v: string) => void }) {
  return (
    <div className="lt-letters" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === ""} onClick={() => onValue("")}>All</button>
      {LETTERS.map((l) => (
        <button key={l} type="button" aria-pressed={value === l} disabled={value !== l && !available.includes(l)} onClick={() => onValue(value === l ? "" : l)}>{l}</button>
      ))}
    </div>
  );
}

/** Saved text such as a biography, with its line breaks. */
export function Prose({ children, testId }: { children: string; testId?: string }) {
  return <div className="lt-prose" data-testid={testId}>{children}</div>;
}

/** A few large figures with what each one counts. */
export function Facts({ items, testId }: { items: { value: string; label: string }[]; testId?: string }) {
  return (
    <ul className="lt-facts-row" data-testid={testId}>
      {items.map((i) => <li key={i.label}><strong>{i.value}</strong> <span>{i.label}</span></li>)}
    </ul>
  );
}

export interface FanCover { titleId: string; title: string; medium: "ebook" | "audio" }

/** Up to five covers in series order, stacked with the first on top. They fan out when their card is hovered or focused. */
export function CoverFan({ covers, author, open }: { covers: FanCover[]; author?: string; open?: boolean }) {
  const shown = covers.slice(0, 5);
  return (
    <div className="lt-fan-stage" data-open={open || undefined} style={{ "--mid": (shown.length - 1) / 2 } as CSSProperties} aria-hidden="true">
      {shown.map((c, k) => (
        <div key={c.titleId} className="lt-fan-cover" style={{ "--k": k, "--z": 10 - k } as CSSProperties}>
          <Cover title={c.title} author={author} titleId={c.titleId} medium={c.medium} />
        </div>
      ))}
    </div>
  );
}

export function SeriesCard({ to, name, books, authors, finished, covers, testId }: {
  to: string; name: string; books: number; authors: string; finished: number; covers: FanCover[]; testId?: string;
}) {
  const progress = finished >= books ? "Finished" : finished > 0 ? `${finished} of ${books} finished` : "None finished";
  return (
    <Link to={to} className="lt-series-card" data-testid={testId}>
      <span className="lt-series-count">{books} {books === 1 ? "book" : "books"}</span>
      <CoverFan covers={covers} author={authors} />
      <span className="lt-series-name">{name}</span>
      <span className="lt-series-meta"><span>{authors}</span><span>{progress}</span></span>
      <span className="lt-series-bar" style={{ "--p": `${Math.round((100 * Math.min(finished, books)) / Math.max(books, 1))}%` } as CSSProperties} aria-hidden="true"><span /></span>
    </Link>
  );
}

export function CardGrid({ kind, children }: { kind: "authors" | "series"; children: ReactNode }) {
  return <div className="lt-card-grid" data-kind={kind}>{children}</div>;
}

/** Books standing on a shelf in one row that scrolls sideways. */
export function Shelf({ children, label, shelfRef }: { children: ReactNode; label: string; shelfRef?: React.Ref<HTMLDivElement> }) {
  return <div ref={shelfRef} className="lt-shelf" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function ShelfItem({ children }: { children: ReactNode }) {
  return <div className="lt-shelf-item">{children}</div>;
}

/** The place a missing book number would take in a series (ADR-0100). */
export function MissingBook({ number }: { number: number }) {
  return <div className="lt-missing" data-testid="missing-book"><span>Book {number} is not in your libraries</span></div>;
}

/** A numbered place in the reading order: the label above, then the book or its gap. */
export function OrderItem({ label, children }: { label: string; children: ReactNode }) {
  return <div className="lt-order-item"><span className="lt-order-no">{label}</span>{children}</div>;
}

export function OrderGrid({ children }: { children: ReactNode }) {
  return <div className="lt-order-grid">{children}</div>;
}
