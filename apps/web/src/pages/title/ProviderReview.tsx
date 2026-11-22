import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminOp, api, ApiError } from "../../api/client";
import type { AutoFillResult, MetadataField, ProviderCandidate, ProviderResult, ProviderSearchResults } from "../../api/types";
import { Badge, Busy, Button, CheckboxField, ErrorBox, icons, Modal, notify, Row, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR } from "../../ui";
import { FIELDS, show } from "./metadataFields";

const PROVIDER_NAME: Record<string, string> = { open_library: "Open Library", google_books: "Google Books", audnexus: "Audnexus", hardcover: "Hardcover" };
const STATUS_TEXT: Record<string, string> = {
  ok: "", no_match: "Nothing found.", unavailable: "Could not be reached or is limiting requests. Try again later.",
  unconfigured: "Not set up: the server operator needs to add its access token.",
};

/** What a field row of the review looks like: the stored value, where it came from, and what the provider offers. */
export interface ReviewRow { field: string; label: string; current: string; source: string | null; offered: unknown; offeredText: string; protectedEdit: boolean; preselected: boolean }

/**
 * Rows for every field the candidate offers that differs from what is stored. A field is preselected only when
 * nothing is stored for it (or only the file name); an edit, a deliberate clear, or a value from the files is
 * never preselected, so a provider cannot replace it without a person ticking that field (ADR-0047/0060).
 */
export function reviewRows(report: { fields: MetadataField[] }, candidate: ProviderCandidate): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const d of FIELDS) {
    if (!(d.field in candidate.fields)) continue;
    const offered = candidate.fields[d.field];
    if (offered === null || offered === undefined) continue;
    const cur = report.fields.find((f) => f.field === d.field);
    const current = cur && !cur.cleared ? show(cur.value) : "";
    const offeredText = show(offered);
    if (offeredText === "" || (cur && !cur.cleared && current === offeredText)) continue;
    const protectedEdit = cur?.source === "user";
    rows.push({
      field: d.field, label: d.label, current: cur?.cleared ? "Deliberately empty" : current, source: cur?.source ?? null,
      offered, offeredText, protectedEdit, preselected: !cur || cur.source === "filename",
    });
  }
  return rows;
}

const sourceText = (s: string | null) => (s === "user" ? "Your edit" : s === "embedded" ? "In the file" : s === "sidecar" ? "Sidecar" : s === "provider" ? "Online" : s === "filename" ? "File name" : "");

/** Search the library's enabled providers for an edition and apply chosen fields (ADR-0049/0060/0047). */
export type ReviewSubject = { kind: "edition" | "recording"; id: string };

/** An edition write carries the revision it was based on; a recording write has none. */
type Report = { revision?: string; fields: MetadataField[] };

const AUTO_FILL_TEXT: Record<string, (r: AutoFillResult) => string> = {
  filled: (r) => `Filled ${r.filled.length} empty ${r.filled.length === 1 ? "field" : "fields"} from ${PROVIDER_NAME[r.provider ?? ""] ?? "a provider"}: ${r.filled.join(", ")}.`,
  nothing_to_fill: () => "A match was found, but every field it offers already has a value.",
  needs_review: () => "No single exact match to fill from. Use Search online to review the candidates.",
  no_match: () => "Nothing found online for this title.",
  disabled: () => "Online lookups are off for this library. An administrator can turn on a provider in the library settings.",
};

export function ProviderReview({ subject, report, onApplied }: { subject: ReviewSubject; report: Report; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const edition = subject.kind === "edition";
  const base = `/admin/${edition ? "editions" : "recordings"}/${subject.id}/metadata`;
  const autoFill = useMutation({
    mutationFn: () => api<AutoFillResult>("POST", `${base}/auto-fill`, edition ? adminOp(report.revision ?? "0") : undefined),
    onSuccess: (r) => {
      const text = AUTO_FILL_TEXT[r.outcome]?.(r) ?? r.outcome;
      if (r.outcome === "filled") notify.success("Auto-fill finished", { detail: text });
      else notify.info("Auto-fill: nothing was filled", { detail: text });
    },
    onSettled: onApplied,
  });
  return (
    <>
      <Button icon={icons.search} onClick={() => setOpen(true)}>Search online</Button>
      <Button icon={icons.bolt} loading={autoFill.isPending} onClick={() => autoFill.mutate()}>Auto-fill</Button>
      {autoFill.error instanceof ApiError && autoFill.error.status === 409
        ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere, so the page was refreshed. Try again.</Text>
        : <ErrorBox error={autoFill.error} />}
      {open && <ProviderDialog subject={subject} report={report} onClose={() => setOpen(false)} onApplied={onApplied} />}
    </>
  );
}

function ProviderDialog({ subject, report, onClose, onApplied }: { subject: ReviewSubject; report: Report; onClose: () => void; onApplied: () => void }) {
  const qc = useQueryClient();
  const edition = subject.kind === "edition";
  const base = `/admin/${edition ? "editions" : "recordings"}/${subject.id}/metadata`;
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [isbn, setIsbn] = useState("");
  const [asin, setAsin] = useState("");
  const [picked, setPicked] = useState<{ provider: string; candidate: ProviderCandidate } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const search = useMutation({
    mutationFn: ({ fresh, ...query }: { title: string; authors: string[]; isbn: string; asin?: string; fresh?: boolean }) => api<ProviderSearchResults>("POST", `${base}/provider-search`, { query, ...(fresh ? { fresh } : {}) }),
    onSuccess: (r) => { setTitle(r.query.title ?? ""); setAuthors((r.query.authors ?? []).join(", ")); setIsbn(r.query.isbn ?? ""); setAsin(r.query.asin ?? ""); },
  });
  // Start with the stored title, authors and ISBN (the server fills them in).
  useEffect(() => { search.mutate({ title: "", authors: [], isbn: "" }); /* once per open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = picked ? reviewRows(report, picked.candidate) : [];
  const apply = useMutation({
    mutationFn: async () => {
      let revision = report.revision ?? "0";
      for (const r of rows.filter((x) => chosen.has(x.field))) {
        if (edition) {
          const out = await api<{ revision: string }>("PUT", `${base}/${r.field}`, { ...adminOp(revision), clear: false, value: r.offered });
          revision = out.revision;
        } else await api<void>("PUT", `${base}/${r.field}`, { value: r.offered });
      }
    },
    meta: { success: () => `Applied ${chosen.size} ${chosen.size === 1 ? "field" : "fields"} from ${PROVIDER_NAME[picked?.provider ?? ""] ?? "the provider"}` },
    onSuccess: () => { onClose(); },
    onSettled: () => { onApplied(); void qc.invalidateQueries({ queryKey: ["admin", edition ? "edition-metadata" : "recording-metadata", subject.id] }); },
  });

  const choose = (provider: string, candidate: ProviderCandidate) => {
    setPicked({ provider, candidate });
    setChosen(new Set(reviewRows(report, candidate).filter((r) => r.preselected).map((r) => r.field)));
    apply.reset();
  };
  const toggle = (field: string, on: boolean) => setChosen((s) => { const n = new Set(s); if (on) n.add(field); else n.delete(field); return n; });
  const run = (fresh = false) => search.mutate({ title: title.trim(), authors: authors.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), isbn: isbn.trim(), ...(edition ? {} : { asin: asin.trim() }), ...(fresh ? { fresh: true } : {}) });
  const stale = apply.error instanceof ApiError && apply.error.status === 409;

  if (picked) {
    return (
      <Modal open onClose={onClose} title={`Review ${PROVIDER_NAME[picked.provider] ?? picked.provider} result`}
        description="Tick the values to use. Anything you apply becomes a protected edit, like any change you make here. The files are not changed."
        actions={
          <>
            <Button icon={icons.arrowLeft} onClick={() => setPicked(null)}>Back to results</Button>
            <Button variant="primary" icon={icons.check} loading={apply.isPending} disabled={chosen.size === 0} onClick={() => apply.mutate()}>
              {`Apply ${chosen.size} ${chosen.size === 1 ? "field" : "fields"}`}
            </Button>
          </>
        }>
        {rows.length === 0 ? <Text tone="dim">This result has nothing new for this edition.</Text> : (
          <Table label="Fields to apply" data-testid="provider-review">
            <THead><TR><TH>Use</TH><TH>Field</TH><TH>Now</TH><TH>Offered</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.field}>
                  <TD><CheckboxField label={<span className="lt-sr">{`Use ${r.label.toLowerCase()}`}</span>} checked={chosen.has(r.field)} onChange={(on) => toggle(r.field, on)} /></TD>
                  <TD>{r.label}</TD>
                  <TD>
                    {r.current || <Text as="span" size="sm" tone="dim">Not set</Text>}
                    {r.source && r.current && <Text size="xs" tone="dim">{sourceText(r.source)}</Text>}
                    {r.protectedEdit && <Badge tone="warning">Replaces your edit</Badge>}
                  </TD>
                  <TD>{r.offeredText}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {stale ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere. Close this window and search again.</Text> : <ErrorBox error={apply.error} />}
      </Modal>
    );
  }

  const data = search.data;
  return (
    <Modal open onClose={onClose} title="Search online for metadata"
      description="Litara sends only this title, these authors and this ISBN to the providers this library has turned on. Your browser never contacts them, and nothing changes until you apply a result."
      actions={<Button icon={icons.close} onClick={onClose}>Close</Button>}>
      <Stack gap="sm">
        <TextField label="Title" value={title} onValue={setTitle} />
        <TextField label="Authors (comma separated)" value={authors} onValue={setAuthors} />
        <Row gap="sm" align="end" wrap>
          <TextField label="ISBN" description="10 or 13 characters without hyphens." value={isbn} onValue={setIsbn} />
          {!edition && <TextField label="ASIN" description="Audible identifier, 10 characters." value={asin} onValue={setAsin} />}
          <Button icon={icons.search} loading={search.isPending} onClick={() => run()}>Search</Button>
        </Row>
        {search.isPending && !data && <Busy />}
        <ErrorBox error={search.error} />
        {data && !data.enabled && <Text>Online lookups are off for this library. An administrator can turn on Open Library or Google Books in the library settings.</Text>}
        {data?.results.map((res) => <ResultBlock key={res.provider} result={res} onChoose={(c) => choose(res.provider, c)} />)}
        {data?.results.some((r) => r.cached) && (
          <Row gap="sm"><Text size="sm" tone="dim">Some results were saved a few minutes ago.</Text><Button size="sm" icon={icons.reset} loading={search.isPending} onClick={() => run(true)}>Search again</Button></Row>
        )}
      </Stack>
    </Modal>
  );
}

function ResultBlock({ result, onChoose }: { result: ProviderResult; onChoose: (c: ProviderCandidate) => void }) {
  return (
    <Stack gap="xs">
      <Row gap="sm"><Text strong>{PROVIDER_NAME[result.provider] ?? result.provider}</Text>{result.cached && <Badge tone="neutral">Saved</Badge>}{STATUS_TEXT[result.status] && <Text size="sm" tone="dim">{STATUS_TEXT[result.status]}</Text>}</Row>
      {result.candidates.map((c) => (
        <Row key={c.id} gap="sm" align="start" wrap>
          <div>
            <Text>{show(c.fields.title) || "(untitled)"}{c.fields.authors ? ` · ${show(c.fields.authors)}` : ""}</Text>
            <Row gap="xs">
              {c.byIdentifier && <Badge tone="success">Exact ISBN match</Badge>}
              <Badge tone={c.consistent ? "info" : "warning"}>{c.consistent ? "Title and authors agree" : "Differs from this edition"}</Badge>
            </Row>
          </div>
          <Button size="sm" icon={icons.check} onClick={() => onChoose(c)} aria-label={`Review ${show(c.fields.title) || "result"} from ${PROVIDER_NAME[result.provider] ?? result.provider}`}>Review</Button>
        </Row>
      ))}
    </Stack>
  );
}
