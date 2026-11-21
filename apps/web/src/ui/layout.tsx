import type { HTMLAttributes, ReactNode } from "react";
import { Heading, Text } from "./text";

export type Gap = "xs" | "sm" | "md" | "lg" | "xl";
type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">;

export function Stack({ gap = "md", ...rest }: DivProps & { gap?: Gap }) {
  return <div className="lt-stack" data-gap={gap} {...rest} />;
}

export function Row({ gap = "sm", justify, align, wrap, grow, ...rest }: DivProps & {
  gap?: Gap; justify?: "between" | "end" | "center"; align?: "start" | "end" | "stretch"; wrap?: boolean; grow?: boolean;
}) {
  return <div className="lt-row" data-gap={gap} data-justify={justify} data-align={align} data-wrap={wrap || undefined} data-grow={grow || undefined} {...rest} />;
}

/** Takes the remaining width inside a Row. */
export function Grow(props: DivProps) {
  return <div className="lt-grow" {...props} />;
}

export function Grid({ min, gap = "lg", ...rest }: DivProps & { min?: "sm" | "lg"; gap?: Gap }) {
  return <div className="lt-grid" data-min={min} data-gap={gap} {...rest} />;
}

export function Card({ tone, pad, selected, look, framed, ...rest }: DivProps & {
  tone?: "success" | "warning" | "danger"; pad?: "sm" | "none"; selected?: boolean; look?: "index";
  /** Corner brackets (Reading Room): for a plate that holds a section's content, not for every card. */
  framed?: boolean;
}) {
  return <div className="lt-card" data-tone={tone} data-pad={pad} data-look={look} data-framed={framed || undefined} data-selected={selected || undefined} {...rest} />;
}

/** `narrow` caps the width for reading and player screens. */
export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className="lt-page" data-narrow={narrow || undefined}>{children}</div>;
}

export function PageHeader({ title, description, actions, serif }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; serif?: boolean }) {
  return (
    <header className="lt-page-header">
      <div>
        <Heading level={1} serif={serif}>{title}</Heading>
        {description && <Text tone="dim">{description}</Text>}
      </div>
      {actions && <Row>{actions}</Row>}
    </header>
  );
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <Stack gap="sm">
        <div className="lt-section-head">
          <Heading level={2}>{title}</Heading>
          {actions}
        </div>
        {children}
      </Stack>
    </section>
  );
}

export function Toolbar(props: DivProps) {
  return <div className="lt-toolbar" role="group" aria-label={props["aria-label"] ?? "Filters"} {...props} />;
}

export function FormColumn(props: DivProps) {
  return <div className="lt-form-col" {...props} />;
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="lt-kv">
      {items.map(([k, v], i) => (<div key={i} className="lt-kv-row"><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  );
}

export function Divider() {
  return <hr className="lt-divider" />;
}

/** A framed plate with a small heading, for one kind of information on a dense page. */
export function Panel({ title, aside, children, ...rest }: Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "title"> & { title: ReactNode; aside?: ReactNode }) {
  return (
    <section className="lt-panel" {...rest}>
      <h2 className="lt-panel-title">{title}{aside && <span>{aside}</span>}</h2>
      {children}
    </section>
  );
}

/** Label and value rows joined by a dotted leader. */
export function Ledger({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="lt-ledger">
      {items.map(([k, v], i) => (<div key={i} className="lt-ledger-row"><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  );
}
