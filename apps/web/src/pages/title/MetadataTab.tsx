import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get } from "../../api/client";
import type { Edition, MetadataField, MetadataReport, RecordingLink, Title } from "../../api/types";
import { ProviderReview, RULE_TEXT, type Draft } from "./ProviderReview";
import { icons, Alert, Badge, Busy, Button, ErrorBox, IconAction, InlineValue, Row, SegmentedField, Stack, Text, TextAreaField, TextField, type Tone } from "../../ui";
import { FIELDS, GROUPS, parseValue, show, type FieldDef } from "./metadataFields";
import { saveMetadata, type FieldChange } from "./metadataSave";
import { MetadataWriteback } from "./MetadataWriteback";

const sourceTone = (s: string): Tone => (s === "user" ? "info" : s === "filename" ? "neutral" : "success");
const sourceName = (s: string) =>
  s === "user" ? "Edited" : s === "embedded" ? "In the file" : s === "sidecar" ? "Sidecar" : s === "provider" ? "Online" : s === "filename" ? "From the file name" : s;

interface Target { id: string; label: string; kind: "edition" | "recording"; titleId: string }

/** Edit what Litara shows for an ebook edition or an audiobook recording. Edits are kept across rescans and never change files. */
export function MetadataTab({ editions, recordings = [] }: { title?: Title; editions: Edition[]; recordings?: RecordingLink[] }) {
  const targets: Target[] = [
    ...editions.map((e) => ({ id: e.id, label: e.label || e.file.format.toUpperCase(), kind: "edition" as const, titleId: e.titleId })),
    ...recordings.map((r) => ({ id: r.id, label: r.label || "Audiobook", kind: "recording" as const, titleId: "" })),
  ];
  const [id, setId] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === id) ?? targets[0];
  if (!target) return <Text tone="dim">This title has no files to edit.</Text>;
  return (
    <Stack>
      {targets.length > 1 && (
        <SegmentedField label="Edit" value={target.id} onValue={setId} items={targets.map((t) => ({ value: t.id, label: t.kind === "recording" ? `Audio: ${t.label}` : t.label }))} />
      )}
      <Editor key={target.id} target={target} edition={editions.find((e) => e.id === target.id)} />
    </Stack>
  );
}

const PROVIDER_NAMES: Record<string, string> = { open_library: "Open Library", google_books: "Google Books", audnexus: "Audnexus", hardcover: "Hardcover" };

/** A change to one field from this tab, and what the notification says once it is saved (locking says nothing: the icon shows it). */
type Change = FieldChange & { note?: string };

function Editor({ target, edition: file }: { target: Target; edition?: Edition }) {
  const qc = useQueryClient();
  const edition = target.kind === "edition";
  const base = edition ? `/admin/editions/${target.id}/metadata` : `/admin/recordings/${target.id}/metadata`;
  const key = ["admin", edition ? "edition-metadata" : "recording-metadata", target.id];
  const report = useQuery({ queryKey: key, queryFn: () => get<MetadataReport>(base), retry: false });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: edition ? ["edition", target.id] : ["recording", target.id] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "title" });
    qc.invalidateQueries({ queryKey: ["titles"] });
  };
  // Auto-fill's result waits here until it is saved. It lives only while this tab is open: leaving the page, the tab or the
  // edition discards it (ADR-0090).
  const [draft, setDraft] = useState<Draft | null>(null);
  const without = (d: Draft, field: string): Draft | null => {
    const { [field]: _gone, ...rest } = d.values;
    return Object.keys(rest).length ? { ...d, values: rest } : null;
  };
  // A save from this tab drops its fields from the draft, and moves the draft on only if it was still current before the
  // save. A change made anywhere else leaves the draft behind, so saving it is a conflict.
  const wrote = (written: string[], from: string, to: string) => setDraft((d) => {
    let next: Draft | null = d;
    for (const f of written) next = next && without(next, f);
    return next && next.revision === from ? { ...next, revision: to } : next;
  });
  // Every change is one save against the revision shown, so only one is in flight at a time (ADR-0095 decision 4).
  const save = useMutation({
    mutationFn: async ({ note: _note, ...c }: Change): Promise<void> => {
      const from = report.data!.revision;
      wrote([c.field], from, (await saveMetadata(base, from, [c])).revision);
    },
    meta: { success: (_d: unknown, c: Change) => c.note },
    onSettled: refresh,
  });
  const saveDraft = useMutation({
    mutationFn: async (): Promise<number> => {
      const entries = Object.entries(draft!.values);
      const from = draft!.revision;
      const after = await saveMetadata(base, from, entries.map(([field, value]) => ({ field, action: "set" as const, clear: false, value })));
      wrote(entries.map(([f]) => f), from, after.revision);
      return entries.length;
    },
    meta: { success: (count: unknown) => `Saved ${count as number} fields from auto-fill` },
    onSettled: refresh,
  });

  if (report.isPending) return <Busy />;
  if (report.error instanceof ApiError && report.error.status === 403) return <Text tone="dim">Editing metadata needs an administrator account with access to this library.</Text>;
  if (report.error) return <ErrorBox error={report.error} />;
  const fields = FIELDS.filter((f) => !f.only || f.only === target.kind);
  const byField = new Map<string, MetadataField>(report.data.fields.map((f) => [f.field, f]));
  const busy = save.isPending || saveDraft.isPending;
  const drafted = Object.keys(draft?.values ?? {}).filter((f) => fields.some((d) => d.field === f));
  const resetDraft = (field: string) => setDraft((d) => d && without(d, field));
  const draftStale = saveDraft.error instanceof ApiError && saveDraft.error.status === 409;
  const stale = save.error instanceof ApiError && save.error.status === 409;

  return (
    <Stack>
      <div className="lt-mf-bar" data-testid="metadata-actions">
        <ProviderReview subject={{ kind: target.kind, id: target.id }} report={report.data} onApplied={refresh} onDraft={(d) => { saveDraft.reset(); setDraft(d); }} onWrote={wrote} />
        <Text size="sm" tone="dim">Click a value to edit it. Edits are kept when the files are rescanned. A locked field cannot be changed, by you or anything else, until it is unlocked.</Text>
      </div>
      {draft && drafted.length > 0 && (
        <Alert tone="info" title="Auto-fill is waiting for your review" data-testid="autofill-draft">
          <Stack gap="xs">
            <Text size="sm">{drafted.length} {drafted.length === 1 ? "field" : "fields"} from {PROVIDER_NAMES[draft.provider] ?? "a provider"}, {RULE_TEXT[draft.rule] ?? "matched"}. Nothing is saved yet. Reset the fields you do not want, or reset all of them if the match is wrong, then save.</Text>
            <Row gap="sm" wrap>
              <Button variant="primary" icon={icons.save} loading={saveDraft.isPending} disabled={busy} onClick={() => saveDraft.mutate()}>Save {drafted.length} {drafted.length === 1 ? "field" : "fields"}</Button>
              <Button icon={icons.reset} disabled={busy} onClick={() => { saveDraft.reset(); setDraft(null); }}>Reset all</Button>
            </Row>
            {draftStale
              ? <Text size="sm" tone="warning" role="alert">This item changed after Auto-fill ran, so these values were not saved over it. Reset all, then run Auto-fill again.</Text>
              : <ErrorBox error={saveDraft.error} />}
          </Stack>
        </Alert>
      )}
      {stale && <Text size="sm" tone="warning" role="alert">This item changed elsewhere, so the fields were refreshed. Try again.</Text>}
      <div className="lt-mf" data-testid="metadata-fields">
        {GROUPS.map((g) => {
          const rows = fields.filter((d) => d.group === g);
          if (rows.length === 0) return null;
          return (
            <section key={g} className="lt-mf-group" aria-label={g}>
              <h3 className="lt-mf-title">{g}</h3>
              {rows.map((d) => (
                <FieldRow key={d.field} def={d} f={byField.get(d.field)} busy={busy} draft={drafted.includes(d.field) ? { value: draft!.values[d.field], reset: () => resetDraft(d.field) } : undefined}
                  pending={save.isPending && save.variables?.field === d.field}
                  onSave={(c) => save.mutateAsync(c).then(() => true, () => false)} />
              ))}
            </section>
          );
        })}
      </div>
      <MetadataWriteback target={target} edition={file} report={report.data} />
    </Stack>
  );
}

function FieldRow({ def, f, busy, pending, draft, onSave }: {
  def: FieldDef; f: MetadataField | undefined; busy: boolean; pending: boolean; draft?: { value: unknown; reset: () => void };
  onSave: (c: Change) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // A locked field is read-only here: it must be unlocked before it can be edited or reset (ADR-0097).
  const locked = !!f?.locked;
  const edited = f?.source === "user";
  const empty = !f || f.cleared || f.value === null || f.value === undefined || show(f.value) === "";
  const start = () => { setText(show(f?.value)); setEditing(true); };
  const commit = async (clear: boolean) => {
    const note = clear ? `${def.label} left empty` : `${def.label} saved`;
    if (await onSave(clear ? { field: def.field, action: "set", clear: true, note } : { field: def.field, action: "set", clear: false, value: parseValue(def.field, text), note })) setEditing(false);
  };
  const toggleLock = () => void onSave({ field: def.field, action: locked ? "unlock" : "lock" });
  const reset = () => void onSave({ field: def.field, action: "reset", note: `${def.label} reset to the value from the files` });
  const canBeEmpty = def.field !== "title";
  const sr = <span className="lt-sr">{def.label}</span>;
  const multi = def.kind === "multiline";

  return (
    <div className="lt-mf-row" data-testid={`field-${def.field}`} data-locked={locked ? "true" : undefined}>
      <div className="lt-mf-label">{def.label}</div>
      <div className="lt-mf-value">
        {draft ? (
          <div className="lt-mf-display lt-mf-draft" data-testid={`draft-${def.field}`}>
            <span className={multi ? "lt-clamp" : undefined}>{show(draft.value)}</span>
          </div>
        ) : editing ? (
          <div className="lt-mf-edit">
            {multi
              ? <TextAreaField label={sr} value={text} onValue={setText} rows={7} autoFocus
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) void commit(false); }} />
              : <TextField label={sr} description={def.kind === "list" ? "Separate several with commas." : def.hint} value={text} onValue={setText} autoFocus
                  inputMode={def.kind === "integer" || def.kind === "number" ? "decimal" : undefined}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && text.trim()) void commit(false); }} />}
            <div className="lt-mf-edit-actions">
              <Button size="sm" variant="primary" disabled={!text.trim() || busy} loading={pending} onClick={() => void commit(false)} icon={icons.save}>Save</Button>
              <Button size="sm" onClick={() => setEditing(false)} icon={icons.close}>Cancel</Button>
              {canBeEmpty && <Button size="sm" disabled={busy} onClick={() => void commit(true)} icon={icons.trash}>Leave empty</Button>}
            </div>
          </div>
        ) : (
          <InlineValue label={locked ? `${def.label} is locked` : `Edit ${def.label}`} onActivate={start} disabled={busy || locked}>
            {f?.cleared ? <span className="lt-mf-dim">Deliberately empty</span>
              : empty ? <span className="lt-mf-dim">{locked ? "Not set" : "Not set. Click to add."}</span>
              : <span className={multi ? "lt-clamp" : undefined}>{show(f!.value)}</span>}
          </InlineValue>
        )}
        {f?.conflicts?.map((c) => <Text key={c.source} size="xs" tone="dim">{sourceName(c.source)} says: {show(c.value)}</Text>)}
      </div>
      <div className="lt-mf-tools">
        {draft && <Badge tone="warning">Unsaved</Badge>}
        {draft && <IconAction label={`Reset ${def.label} to what it was`} icon={icons.reset} disabled={busy} onClick={draft.reset} />}
        {!draft && f && <Badge tone={sourceTone(f.source)}>{sourceName(f.source)}</Badge>}
        {!draft && edited && !locked && <IconAction label={`Reset ${def.label} to the value from the files`} icon={icons.reset} disabled={busy} onClick={reset} />}
        {!draft && <IconAction label={locked ? `Unlock ${def.label}; the value stays` : `Lock ${def.label} as it is`} icon={locked ? icons.lock : icons.unlock}
          disabled={busy || (!locked && empty && !canBeEmpty)} onClick={toggleLock} />}
      </div>
    </div>
  );
}
