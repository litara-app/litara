import { Progress, ProgressIndicator, ProgressTrack } from "@ui-sdk/react/progress";
import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { API, ApiError } from "../api/client";
import type { Capability } from "../api/types";
import { IconButton } from "./controls";
import { useCoverRev } from "./coverRev";
import { wasReported } from "./notify";
import { Heading, Text } from "./text";

export type Tone = "info" | "neutral" | "success" | "warning" | "danger" | "audio";
type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, "className" | "style">;
type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">;

export function Badge({ tone = "info", outline, ...rest }: SpanProps & { tone?: Tone; outline?: boolean }) {
  return <span className="lt-badge" data-tone={tone} data-outline={outline || undefined} {...rest} />;
}

const status: Record<string, { tone: Tone; label: string }> = {
  reading: { tone: "info", label: "Reading" },
  listening: { tone: "audio", label: "Listening" },
  finished: { tone: "success", label: "Finished" },
  unread: { tone: "neutral", label: "Unread" },
  ready: { tone: "success", label: "Ready" },
  incomplete: { tone: "warning", label: "Incomplete" },
  unsupported: { tone: "neutral", label: "Unsupported" },
};
/** One vocabulary for state words so the same state looks the same on every screen. */
export function StatusPill({ state }: { state: string }) {
  const s = status[state] ?? { tone: "neutral" as Tone, label: state };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function FormatTag({ format }: { format: string }) {
  const f = format.toUpperCase();
  return <span className="lt-tag" data-audio={f === "M4B" || f === "MP3" || undefined}>{f}</span>;
}

const capTone = { supported: "success", incomplete: "warning", unsupported: "neutral" } as const;
export function CapBadge({ name, cap }: { name: string; cap: Capability }) {
  return <Badge tone={capTone[cap.state]} title={cap.issues.map((i) => i.detail).join(" ")}>{name}: {cap.state}</Badge>;
}

export function Alert({ tone = "info", title, role, onClose, children, ...rest }: Omit<DivProps, "role" | "title"> & {
  tone?: Tone; title?: ReactNode; role?: "alert" | "status"; onClose?: () => void;
}) {
  return (
    <div className="lt-alert" data-tone={tone} role={role ?? (tone === "danger" ? "alert" : "status")} {...rest}>
      {title && <span className="lt-alert-title">{title}</span>}
      <div>{children}</div>
      {onClose && <IconButton variant="subtle" aria-label="Dismiss" onClick={onClose}>×</IconButton>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error || wasReported(error)) return null; // a failed action is shown as a notification, not twice
  const e = error as Error;
  const code = error instanceof ApiError && error.code ? ` (${error.code})` : "";
  return <Alert tone="danger" title="Something went wrong" role="alert">{e.message}{code}</Alert>;
}

export function Busy() {
  return <div className="lt-busy"><div className="lt-spinner" role="status" aria-label="Loading" /></div>;
}

export function EmptyState({ title, children, action, level = 2 }: { title: string; children?: ReactNode; action?: ReactNode; level?: 2 | 3 }) {
  return (
    <div className="lt-empty">
      <svg viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M48 12C38 6 22 6 8 10v44c14-4 30-4 40 2 10-6 26-6 40-2V10C74 6 58 6 48 12z" />
        <path d="M48 12v44M16 20c8-2 16-2 24 1M16 30c8-2 16-2 24 1M56 21c8-3 16-3 24-1M56 31c8-3 16-3 24-1" />
      </svg>
      <Heading level={level}>{title}</Heading>
      {children && <Text tone="dim">{children}</Text>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, label, tone }: { value: number; label: string; tone?: "success" }) {
  return (
    <Progress className="lt-progress" data-tone={tone} value={value} aria-label={label}>
      <ProgressTrack><ProgressIndicator /></ProgressTrack>
    </Progress>
  );
}

export interface TimelineMark { id: string; at: number; kind: "chapter" | "bookmark" | "note" | "highlight"; label: string; onPick?: () => void }

/** Progress through a book with its chapters, bookmarks, notes and highlights marked along it. A mark with an action jumps there. */
export function ReadingTimeline({ value, label, marks, onSeek }: { value: number; label: string; marks: TimelineMark[]; onSeek?: (fraction: number) => void }) {
  return (
    <div className="lt-timeline" data-seek={onSeek ? "" : undefined}
      onClick={onSeek ? (ev) => { if ((ev.target as HTMLElement).closest("button")) return; const r = ev.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))); } : undefined}>
      <ProgressBar value={value} label={label} />
      {marks.map((m) => {
        const at = { "--at": `${Math.round(Math.min(1, Math.max(0, m.at)) * 1000) / 10}%` } as CSSProperties;
        return m.onPick
          ? <button key={m.id} type="button" className="lt-tl-mark" data-kind={m.kind} style={at} title={m.label} aria-label={`Go to ${m.label}`} onClick={m.onPick} />
          : <span key={m.id} className="lt-tl-mark" data-kind={m.kind} style={at} title={m.label} />;
      })}
    </div>
  );
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
/** Generated placeholder cover until artwork is available. */
/**
 * A title's cover. The generated placeholder is always drawn; when `titleId` is given the real cover (ADR-0086) is laid
 * over it once it has loaded, so a title with no cover, or one still loading, shows the placeholder instead of a gap.
 */
export function Cover({ title, author, tiny, titleId, medium = "ebook" }: { title: string; author?: string; tiny?: boolean; titleId?: string; medium?: "ebook" | "audio" }) {
  const rev = useCoverRev();
  const src = titleId ? `${API}/titles/${titleId}/cover?medium=${medium}&r=${rev}` : null;
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className="lt-cover" data-tiny={tiny || undefined} data-real={loaded === src && src ? true : undefined} style={{ "--h": hue(title) } as CSSProperties} aria-hidden="true">
      <b>{title}</b>
      <i>{(author ?? "").split(" ").pop()}</i>
      {src && <img className="lt-cover-img" src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(src)} onError={() => setLoaded(null)} />}
    </div>
  );
}
