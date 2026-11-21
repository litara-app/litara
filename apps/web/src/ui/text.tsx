import { useShortcutHint } from "@ui-sdk/react/shortcuts";
import type { HTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

type Tone = "dim" | "success" | "warning" | "danger";
type SpanProps = Omit<HTMLAttributes<HTMLElement>, "className" | "style">;

export function Text({ size, tone, strong, mono, clamp, as: Tag = "p", ...rest }: SpanProps & {
  size?: "xs" | "sm" | "lg"; tone?: Tone; strong?: boolean; mono?: boolean; clamp?: number; as?: "p" | "span" | "div";
}) {
  const style = clamp ? ({ "--clamp": clamp } as React.CSSProperties) : undefined;
  return <Tag className="lt-text" data-size={size} data-tone={tone} data-strong={strong || undefined} data-mono={mono || undefined} data-clamp={clamp ? "" : undefined} style={style} {...rest} />;
}

export function Heading({ level, serif, children, ...rest }: SpanProps & { level: 1 | 2 | 3 | 4; serif?: boolean; children: ReactNode }) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
  return <Tag className="lt-heading" data-level={level} data-serif={serif || undefined} {...rest}>{children}</Tag>;
}

export function Code(props: SpanProps) {
  return <code className="lt-code" {...props} />;
}

/** Preformatted text that keyboard users can scroll. */
export function CodeBlock({ label, children }: { label: string; children: ReactNode }) {
  return <pre className="lt-codeblock" tabIndex={0} role="region" aria-label={label}>{children}</pre>;
}

function ShortcutKeys({ shortcut }: { shortcut: string }) {
  return <>{useShortcutHint(shortcut).text}</>;
}

/**
 * A keyboard key. UI SDK has no Kbd component; its docs mark keys up as `<kbd aria-hidden data-slot="kbd">` and give
 * `useShortcutHint` for the platform's text, so this follows that. Pass `shortcut="mod+k"` for the right keys per platform.
 */
export function Kbd({ shortcut, children, ...rest }: SpanProps & { shortcut?: string }) {
  return <kbd className="lt-kbd" aria-hidden="true" data-slot="kbd" {...rest}>{shortcut ? <ShortcutKeys shortcut={shortcut} /> : children}</kbd>;
}

/** Text quoted from a book. */
export function Quote({ children, cite }: { children: ReactNode; cite?: ReactNode }) {
  return <figure className="lt-quote"><blockquote>{children}</blockquote>{cite && <figcaption>{cite}</figcaption>}</figure>;
}

export function TextLink({ ...rest }: Omit<LinkProps, "className" | "style">) {
  return <Link className="lt-link" {...rest} />;
}
