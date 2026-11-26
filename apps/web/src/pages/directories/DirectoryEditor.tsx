import { useState } from "react";
import { Badge, Busy, Button, ErrorBox, IconAction, icons, ImageDrop, InlineValue, SelectField, SourceCredit, Stack, Text, TextAreaField, TextField } from "../../ui";
import { providerName, useDirectoryDetails, useDirectoryEdit, type DirectoryEdit, type DirectoryField, type DirectoryKind } from "./directoryDetails";
import { DirectoryLookup } from "./DirectoryLookup";

interface Def { field: string; label: string; input?: "multiline" | "number" | "status"; hint?: string; max?: number }

const GROUPS: Record<DirectoryKind, { title: string; fields: Def[] }[]> = {
  author: [
    { title: "Name", fields: [{ field: "last_name", label: "Last name", max: 200, hint: "Used for sorting and the A to Z letters. Change it if the guess is wrong." }] },
    { title: "About", fields: [
      { field: "introduction", label: "Introduction", max: 500, hint: "One or two lines under the name." },
      { field: "biography", label: "Biography", max: 8000, input: "multiline" },
    ] },
  ],
  series: [
    { title: "About this series", fields: [{ field: "description", label: "Description", max: 8000, input: "multiline" }] },
    { title: "Series facts", fields: [
      { field: "book_count", label: "Books in series", input: "number", hint: "A whole number." },
      { field: "status", label: "Status", input: "status" },
    ] },
  ],
};

const STATUSES = [{ value: "ongoing", label: "Ongoing" }, { value: "complete", label: "Complete" }];

const display = (def: Def, value: DirectoryField["value"]) =>
  def.input === "status" ? STATUSES.find((s) => s.value === value)?.label ?? String(value) : String(value);

/** The notice shown when an edit lost to a change made elsewhere. */
function Conflict() {
  return <Text size="sm" tone="warning" role="alert">This changed elsewhere, so it was refreshed. Try again.</Text>;
}

/** The edit tab of an author or series page, laid out as the book's Edit metadata tab (ADR-0097, ADR-0102). */
export function DirectoryEditor({ kind, name }: { kind: DirectoryKind; name: string }) {
  const details = useDirectoryDetails(kind, name);
  const { save, busy, conflict } = useDirectoryEdit(kind, name);
  if (details.isPending) return <Busy />;
  if (details.error) return <ErrorBox error={details.error} />;
  return (
    <Stack>
      <Text size="sm" tone="dim">
        Click a value to edit it. These details are shared with everyone who can see this {kind}. A locked field cannot be changed until it is unlocked.
        {kind === "author" && " Change the photo under the portrait."}
      </Text>
      <DirectoryLookup kind={kind} name={name} details={details.data} />
      {details.data.match && (
        <div data-testid="series-match">
          <Stack gap="xs">
            <SourceCredit label={`Matched to “${details.data.match.name}” on`} provider={providerName(details.data.match.provider)} url={details.data.match.url} />
            <div>
              <Button size="sm" icon={icons.trash} disabled={busy}
                onClick={() => save.mutate({ kind: "changes", changes: [{ field: "match", action: "reset" }], note: "Series match removed" })}>Remove match</Button>
            </div>
          </Stack>
        </div>
      )}
      {conflict ? <Conflict /> : <ErrorBox error={save.error} />}
      <div className="lt-mf" data-testid="directory-fields">
        {GROUPS[kind].map((g) => (
          <section key={g.title} className="lt-mf-group" aria-label={g.title}>
            <h3 className="lt-mf-title">{g.title}</h3>
            {g.fields.map((d) => (
              <Row key={d.field} def={d} f={details.data.fields.find((f) => f.field === d.field)!} busy={busy}
                onSave={(edit) => save.mutateAsync(edit).then(() => true, () => false)} />
            ))}
          </section>
        ))}
      </div>
    </Stack>
  );
}

function Row({ def, f, busy, onSave }: { def: Def; f: DirectoryField; busy: boolean; onSave: (e: DirectoryEdit) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const locked = f.locked;
  const empty = f.value === null;
  const canBeEmpty = def.field !== "last_name";
  const sr = <span className="lt-sr">{def.label}</span>;
  const typed = text.trim();
  const number = Number(typed);
  const valid = def.input === "number" ? Number.isInteger(number) && number >= 1 && number <= 10000 : typed !== "";
  const change = (note: string | undefined, c: Extract<DirectoryEdit, { kind: "changes" }>["changes"][number]) =>
    onSave({ kind: "changes", changes: [c], note });
  const start = () => { setText(empty ? "" : String(f.value)); setEditing(true); };
  const commit = async (clear: boolean) => {
    const done = clear
      ? await change(`${def.label} left empty`, { field: def.field, action: "set", clear: true })
      : await change(`${def.label} saved`, { field: def.field, action: "set", clear: false, value: def.input === "number" ? number : typed });
    if (done) setEditing(false);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Enter" && valid && !busy && (def.input !== "multiline" || e.ctrlKey || e.metaKey)) void commit(false);
  };
  const resetLabel = def.field === "last_name" ? `Reset ${def.label} to the guess` : `Remove the saved ${def.label}`;

  return (
    <div className="lt-mf-row" data-testid={`field-${def.field}`} data-locked={locked ? "true" : undefined}>
      <div className="lt-mf-label">{def.label}</div>
      <div className="lt-mf-value">
        {editing && !locked ? (
          <div className="lt-mf-edit">
            {def.input === "multiline" ? <TextAreaField label={sr} value={text} onValue={setText} rows={8} maxLength={def.max} autoFocus onKeyDown={keys} />
              : def.input === "status" ? <SelectField label={sr} items={STATUSES} value={text || null} onValue={(v) => setText(v ?? "")} placeholder="Choose a status" />
              : <TextField label={sr} description={def.hint} value={text} onValue={setText} maxLength={def.max} autoFocus inputMode={def.input === "number" ? "numeric" : undefined} onKeyDown={keys} />}
            <div className="lt-mf-edit-actions">
              <Button size="sm" variant="primary" disabled={!valid || busy} onClick={() => void commit(false)} icon={icons.save}>Save</Button>
              <Button size="sm" onClick={() => setEditing(false)} icon={icons.close}>Cancel</Button>
              {canBeEmpty && <Button size="sm" disabled={busy} onClick={() => void commit(true)} icon={icons.trash}>Leave empty</Button>}
            </div>
          </div>
        ) : (
          <InlineValue label={locked ? `${def.label} is locked` : `Edit ${def.label}`} onActivate={start} disabled={busy || locked}>
            {f.cleared ? <span className="lt-mf-dim">Deliberately empty</span>
              : empty ? <span className="lt-mf-dim">{locked ? "Not set" : "Not set. Click to add."}</span>
              : <span className={def.input === "multiline" ? "lt-clamp" : undefined}>{display(def, f.value)}</span>}
          </InlineValue>
        )}
        {def.field === "last_name" && !editing && <Text size="xs" tone="dim">{def.hint}</Text>}
        {f.provider && !editing && <SourceCredit label="From" provider={providerName(f.provider)} url={f.providerUrl} />}
      </div>
      <div className="lt-mf-tools">
        {f.source !== "none" && <Badge tone={f.source === "user" ? "info" : "neutral"}>{f.source === "user" ? "Edited" : "Guessed"}</Badge>}
        {f.source === "user" && !locked && (
          <IconAction label={resetLabel} icon={icons.reset} disabled={busy}
            onClick={() => { setEditing(false); void change(def.field === "last_name" ? "Last name reset to the guess" : `${def.label} removed`, { field: def.field, action: "reset" }); }} />
        )}
        <IconAction label={locked ? `Unlock ${def.label}; the value stays` : `Lock ${def.label} as it is`} icon={locked ? icons.lock : icons.unlock}
          disabled={busy} onClick={() => { setEditing(false); void change(undefined, { field: def.field, action: locked ? "unlock" : "lock" }); }} />
      </div>
    </div>
  );
}

const PHOTO_SOURCE = {
  upload: "an image you uploaded", url: "an image from an address you entered", provider: "a photo from an online lookup", none: "nothing, so initials are shown",
};

/** The photo tools under the portrait, laid out as the cover tools on a title page (ADR-0105). */
export function PhotoTools({ name }: { name: string }) {
  const details = useDirectoryDetails("author", name);
  const { save, busy, conflict } = useDirectoryEdit("author", name);
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  if (details.isPending) return <Busy />;
  const photo = details.data?.photo;
  if (!photo) return <ErrorBox error={details.error} />;
  const disabled = busy || photo.locked;
  const run = (e: DirectoryEdit, done?: () => void) => { setNotice(null); save.mutate(e, { onSuccess: done }); };

  return (
    <div className="lt-cover-tools" data-testid="photo-tools">
      <Stack gap="sm">
        <Text size="sm" tone="dim">Currently: {PHOTO_SOURCE[photo.source]}.</Text>
        <ImageDrop label="Choose a photo" disabled={disabled} onFile={(file) => run({ kind: "upload", file, note: "Photo replaced" })} onReject={setNotice} />
        <TextField label="Or use an image address" placeholder="https://example.com/photo.jpg" value={address} onValue={setAddress} type="url" disabled={disabled} />
        <Button icon={icons.download} block disabled={disabled || address.trim().length < 8}
          onClick={() => run({ kind: "url", url: address.trim(), note: "Photo replaced" }, () => setAddress(""))}>Use this address</Button>
        <Button icon={icons.trash} block disabled={disabled || photo.source === "none"}
          onClick={() => run({ kind: "changes", changes: [{ field: "photo", action: "reset" }], note: "Photo removed" })}>Remove photo</Button>
        {notice && <Text size="sm" tone="danger" role="alert">{notice}</Text>}
        {conflict ? <Conflict /> : <ErrorBox error={save.error} />}
        <div className="lt-lockline">
          <Text size="sm">{photo.locked ? "Photo is locked. Unlock it to change it." : "Lock this photo"}</Text>
          <IconAction label={photo.locked ? "Unlock photo" : "Lock photo"} icon={photo.locked ? icons.lock : icons.unlock} disabled={busy}
            onClick={() => run({ kind: "changes", changes: [{ field: "photo", action: photo.locked ? "unlock" : "lock" }] })} />
        </div>
        <Text size="xs" tone="dim">A photo you choose is stored by Litara.</Text>
      </Stack>
    </div>
  );
}
