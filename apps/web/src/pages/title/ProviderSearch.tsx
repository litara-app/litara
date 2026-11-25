import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { adminOp, api, ApiError } from "../../api/client";
import type { MetadataField, ProviderCandidate, ProviderResult, ProviderSearchResults } from "../../api/types";
import { Badge, Busy, Button, Drawer, ErrorBox, icons, PickCard, Row, SegmentedField, Text, TextField, ToggleChip } from "../../ui";
import { show } from "./metadataFields";
import { defaultAction, reviewFields, valueFor, type Action, type ReviewRow } from "./reviewFields";

export const PROVIDER_NAME: Record<string, string> = { open_library: "Open Library", google_books: "Google Books", audnexus: "Audnexus", hardcover: "Hardcover" };
const STATUS_TEXT: Record<string, string> = {
  ok: "", no_match: "Nothing found.", unavailable: "Could not be reached or is limiting requests. Try again later.",
  unconfigured: "Not set up: the server operator needs to add its access token.",
};
const sourceText = (s: string | null) => (s === "user" ? "Your edit" : s === "embedded" ? "In the file" : s === "sidecar" ? "Sidecar" : s === "provider" ? "Online" : s === "filename" ? "File name" : "");

export type ReviewSubject = { kind: "edition" | "recording"; id: string };
/** Told about each field this tab has just written, with the edition revisions before and after. */
export type WroteHandler = (field: string, from?: string, to?: string) => void;
/** An edition write carries the revision it was based on; a recording write has none. */
export type Report = { revision?: string; fields: MetadataField[] };

/**
 * Search the library's providers and compare one result with what is stored, field by field. Everything is chosen here
 * and nothing is stored until Apply (ADR-0049/0060/0047).
 */
export function ProviderDialog({ subject, report, onClose, onApplied, onWrote }: { subject: ReviewSubject; report: Report; onClose: () => void; onApplied: () => void; onWrote?: WroteHandler }) {
  const qc = useQueryClient();
  const edition = subject.kind === "edition";
  const base = `/admin/${edition ? "editions" : "recordings"}/${subject.id}/metadata`;
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [isbn, setIsbn] = useState("");
  const [asin, setAsin] = useState("");
  const [known, setKnown] = useState<string[]>([]); // the providers this library has turned on, learned from the first search
  const [only, setOnly] = useState<Set<string> | null>(null); // null searches every provider
  const [picked, setPicked] = useState<{ provider: string; candidate: ProviderCandidate } | null>(null);
  const [plan, setPlan] = useState<Record<string, Action>>({});
  const [view, setView] = useState<"differences" | "all">("differences");

  const search = useMutation({
    mutationFn: ({ fresh, providers, ...query }: { title: string; authors: string[]; isbn: string; asin?: string; fresh?: boolean; providers?: string[] }) =>
      api<ProviderSearchResults>("POST", `${base}/provider-search`, { query, ...(fresh ? { fresh } : {}), ...(providers ? { providers } : {}) }),
    onSuccess: (r, v) => {
      setTitle(r.query.title ?? ""); setAuthors((r.query.authors ?? []).join(", ")); setIsbn(r.query.isbn ?? ""); setAsin(r.query.asin ?? "");
      if (!v.providers) setKnown(r.results.map((x) => x.provider));
      setPicked(null);
    },
  });
  // Start with the stored title, authors and ISBN (the server fills them in).
  useEffect(() => { search.mutate({ title: "", authors: [], isbn: "" }); /* once per open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = useMemo(() => (picked ? reviewFields(report, picked.candidate) : []), [report, picked]);
  const rows = view === "all" ? allRows : allRows.filter((r) => !r.same);
  const differing = allRows.filter((r) => !r.same).length;
  const staged = allRows.filter((r) => (plan[r.field] ?? "keep") !== "keep" && !r.same);

  const apply = useMutation({
    mutationFn: async () => {
      let revision = report.revision ?? "0";
      for (const r of staged) {
        const value = valueFor(r, plan[r.field]!);
        if (edition) {
          const from = revision;
          revision = (await api<{ revision: string }>("PUT", `${base}/${r.field}`, { ...adminOp(from), clear: false, value })).revision;
          onWrote?.(r.field, from, revision);
        } else {
          await api<void>("PUT", `${base}/${r.field}`, { value });
          onWrote?.(r.field);
        }
      }
    },
    meta: { success: () => `Applied ${staged.length} ${staged.length === 1 ? "field" : "fields"} from ${PROVIDER_NAME[picked?.provider ?? ""] ?? "the provider"}` },
    onSuccess: () => { onClose(); },
    onSettled: () => { onApplied(); void qc.invalidateQueries({ queryKey: ["admin", edition ? "edition-metadata" : "recording-metadata", subject.id] }); },
  });

  const choose = (provider: string, candidate: ProviderCandidate) => {
    setPicked({ provider, candidate });
    setPlan(Object.fromEntries(reviewFields(report, candidate).map((r) => [r.field, defaultAction(r)])));
    setView("differences");
    apply.reset();
  };
  const setAction = (field: string, a: Action) => setPlan((p) => ({ ...p, [field]: a }));
  // "Use all" never touches an edit or a deliberate clear; those are replaced only by choosing the field itself (ADR-0097).
  const bulk = allRows.filter((r) => !r.same && !r.protectedEdit);
  const useAll = () => setPlan((p) => ({ ...p, ...Object.fromEntries(bulk.map((r) => [r.field, r.kind === "list" ? "merge" : "use"])) }));
  const keepAll = () => setPlan((p) => ({ ...p, ...Object.fromEntries(allRows.map((r) => [r.field, "keep"])) }));

  const providers = (): string[] | undefined => (only && only.size > 0 && only.size < known.length ? [...only] : undefined);
  // With All on, picking a source narrows the search to just that one; after that, sources are added or removed one by one.
  // Nothing picked, or every source picked, is All again.
  const toggle = (name: string) => {
    const next = only === null ? new Set([name]) : new Set(only);
    if (only !== null) { if (next.has(name)) next.delete(name); else next.add(name); }
    setOnly(next.size === 0 || next.size === known.length ? null : next);
  };
  const run = (fresh = false) => search.mutate({
    title: title.trim(), authors: authors.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), isbn: isbn.trim(),
    ...(edition ? {} : { asin: asin.trim() }), ...(fresh ? { fresh: true } : {}), ...(providers() ? { providers: providers() } : {}),
  });
  const stale = apply.error instanceof ApiError && apply.error.status === 409;
  const data = search.data;

  return (
    <Drawer open onClose={onClose} size="xl" flush title="Search online for metadata"
      description="Litara sends only this title, these authors and this ISBN to the providers you pick. Your browser never contacts them, and nothing changes until you apply."
      actions={
        <>
          <span className="lt-ps-status">{staged.length === 0 ? "Nothing staged. Choose Use on a field." : `${staged.length} ${staged.length === 1 ? "field" : "fields"} staged. Applying them makes each a protected edit.`}</span>
          <Button icon={icons.close} onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={icons.check} loading={apply.isPending} disabled={staged.length === 0} onClick={() => apply.mutate()}>
            {`Apply ${staged.length} ${staged.length === 1 ? "field" : "fields"}`}
          </Button>
        </>
      }>
      <div className="lt-ps">
        <aside className="lt-ps-side" aria-label="Search and results">
          <form className="lt-ps-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <TextField label="Title" value={title} onValue={setTitle} />
            <TextField label="Authors (comma separated)" value={authors} onValue={setAuthors} />
            <TextField label="ISBN" description="10 or 13 characters without hyphens." value={isbn} onValue={setIsbn} />
            {!edition && <TextField label="ASIN" description="Audible identifier, 10 characters." value={asin} onValue={setAsin} />}
            {known.length > 1 && (
              <div className="lt-ps-sources" role="group" aria-label="Sources">
                <span className="lt-ps-sources-cap">Sources</span>
                <div className="lt-ps-chips">
                  <ToggleChip label="All" pressed={only === null} onChange={() => setOnly(null)} />
                  {known.map((p) => <ToggleChip key={p} label={PROVIDER_NAME[p] ?? p} pressed={only !== null && only.has(p)} onChange={() => toggle(p)} />)}
                </div>
              </div>
            )}
            <Button type="submit" variant="primary" block icon={icons.search} loading={search.isPending} >Search</Button>
          </form>
          {search.isPending && !data && <Busy />}
          <ErrorBox error={search.error} />
          {data && !data.enabled && <Text>Online lookups are off for this library. An administrator can turn on a provider in the library settings.</Text>}
          {data?.results.map((res) => <ResultBlock key={res.provider} result={res} picked={picked && picked.provider === res.provider ? picked.candidate.id : null} onChoose={(c) => choose(res.provider, c)} />)}
          {data?.results.some((r) => r.cached) && (
            <Row gap="sm" wrap><Text size="sm" tone="dim">Some results were saved a few minutes ago.</Text><Button size="sm" icon={icons.reset} loading={search.isPending} onClick={() => run(true)}>Search again</Button></Row>
          )}
        </aside>

        <section className="lt-ps-main" aria-label="Compare with this edition">
          {!picked ? (
            <div className="lt-ps-empty"><Text tone="dim">Choose a result to compare it with what is stored, field by field.</Text></div>
          ) : (
            <>
              <header className="lt-ps-head">
                <div className="lt-ps-headmain">
                  <Text strong>{show(picked.candidate.fields.title) || "(untitled)"}</Text>
                  <Text size="sm" tone="dim">{[show(picked.candidate.fields.authors), show(picked.candidate.fields.published), picked.candidate.fields.page_count ? `${picked.candidate.fields.page_count} pages` : "", show(picked.candidate.fields.publisher)].filter(Boolean).join(" · ")}</Text>
                  <Row gap="xs" wrap>
                    <Badge tone="info">{PROVIDER_NAME[picked.provider] ?? picked.provider}</Badge>
                    {picked.candidate.byIdentifier && <Badge tone="success">Exact ISBN match</Badge>}
                    <Badge tone={picked.candidate.consistent ? "info" : "warning"}>{picked.candidate.consistent ? "Same title and author" : "Differs from this edition"}</Badge>
                  </Row>
                </div>
              </header>
              <div className="lt-ps-bar">
                <SegmentedField label="Which fields" value={view} onValue={(v) => setView(v === "all" ? "all" : "differences")}
                  items={[{ value: "differences", label: `Differences ${differing}` }, { value: "all", label: `All fields ${allRows.length}` }]} />
                <Row gap="xs">
                  <Button size="sm" icon={icons.check} disabled={bulk.length === 0} onClick={useAll}>{`Use all ${bulk.length}`}</Button>
                  <Button size="sm" icon={icons.reset} disabled={staged.length === 0} onClick={keepAll}>Keep all</Button>
                </Row>
              </div>
              <div className="lt-ps-fields" data-testid="provider-review">
                {rows.length === 0 && <Text tone="dim">This result has nothing new for this edition.</Text>}
                {rows.map((r) => <FieldCompare key={r.field} row={r} action={plan[r.field] ?? "keep"} onAction={(a) => setAction(r.field, a)} />)}
              </div>
              {stale ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere. Close this window and search again.</Text> : <ErrorBox error={apply.error} />}
            </>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function ResultBlock({ result, picked, onChoose }: { result: ProviderResult; picked: string | null; onChoose: (c: ProviderCandidate) => void }) {
  return (
    <div className="lt-cand-group">
      <div className="lt-cand-source"><Text strong>{PROVIDER_NAME[result.provider] ?? result.provider}</Text>{result.cached && <Badge tone="neutral">Saved</Badge>}{STATUS_TEXT[result.status] && <Text size="sm" tone="dim">{STATUS_TEXT[result.status]}</Text>}</div>
      {result.candidates.map((c) => (
        <PickCard key={c.id} selected={picked === c.id} onPick={() => onChoose(c)} label={`Review ${show(c.fields.title) || "result"} from ${PROVIDER_NAME[result.provider] ?? result.provider}`}>
          <span className="lt-cand-main">
            <span>{show(c.fields.title) || "(untitled)"}{c.fields.authors ? ` · ${show(c.fields.authors)}` : ""}</span>
            <span className="lt-cand-badges">
              {c.byIdentifier && <Badge tone="success">Exact ISBN match</Badge>}
              <Badge tone={c.consistent ? "info" : "warning"}>{c.consistent ? "Title and authors agree" : "Differs from this edition"}</Badge>
            </span>
          </span>
        </PickCard>
      ))}
    </div>
  );
}

function Value({ kind, raw, text }: { kind: string; raw: unknown; text: string }) {
  if (kind === "list" && Array.isArray(raw) && raw.length > 0) {
    return <div className="lt-ps-chips">{raw.map((x) => <span key={String(x)} className="lt-ps-chip">{String(x)}</span>)}</div>;
  }
  return <span className={kind === "multiline" ? "lt-ps-long" : undefined}>{text}</span>;
}

/** One field: what is stored, what is offered, and what to do about it. */
function FieldCompare({ row, action, onAction }: { row: ReviewRow; action: Action; onAction: (a: Action) => void }) {
  const list = row.kind === "list";
  const status = row.same ? <Badge tone="neutral">Same</Badge>
    : row.protectedEdit ? <Badge tone="warning">Replaces your edit</Badge>
    : row.current === "" ? <Badge tone="success">Fills empty</Badge>
    : <Badge tone="warning">Differs</Badge>;
  return (
    <div className="lt-pf" data-staged={action !== "keep" || undefined}>
      <div className="lt-pf-head">
        <span className="lt-pf-label">{row.label}</span>
        {status}
        {!row.same && (
          <div className="lt-pf-act">
            <SegmentedField label={`What to do with ${row.label.toLowerCase()}`} value={action} onValue={(v) => onAction(v as Action)}
              items={list ? [{ value: "keep", label: "Keep" }, { value: "merge", label: "Merge" }, { value: "replace", label: "Replace" }] : [{ value: "keep", label: "Keep" }, { value: "use", label: "Use" }]} />
          </div>
        )}
      </div>
      <div className="lt-pf-cols">
        <div className="lt-pf-cell" data-side="current">
          <span className="lt-pf-cap">Now{row.source && row.current ? ` · ${sourceText(row.source)}` : ""}</span>
          {row.current ? <Value kind={row.kind} raw={row.currentRaw} text={row.current} /> : <span className="lt-mf-dim">Not set</span>}
        </div>
        <div className="lt-pf-cell" data-side="offered">
          <span className="lt-pf-cap">Offered</span>
          <Value kind={row.kind} raw={row.offered} text={row.offeredText} />
        </div>
      </div>
    </div>
  );
}
