import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminOp, api, ApiError, get } from "../../api/client";
import type { Edition, MetadataField, MetadataReport, RecordingLink, Title } from "../../api/types";
import { CoverEditor } from "./CoverEditor";
import { ProviderReview } from "./ProviderReview";
import { icons, Badge, Busy, Button, ErrorBox, Modal, Row, SegmentedField, Stack, Table, TBody, TD, Text, TextAreaField, TextField, TH, THead, TR, type Tone } from "../../ui";
import { FIELDS, parseValue, show } from "./metadataFields";

const sourceTone = (s: string): Tone => (s === "user" ? "info" : s === "filename" ? "neutral" : "success");
const sourceName = (s: string) =>
  s === "user" ? "Edited" : s === "embedded" ? "In the file" : s === "sidecar" ? "Sidecar" : s === "provider" ? "Online" : s === "filename" ? "From the file name" : s;

interface Target { id: string; label: string; kind: "edition" | "recording"; titleId: string }

/** Edit what Litara shows for an ebook edition or an audiobook recording. Edits are kept across rescans and never change files. */
export function MetadataTab({ title, editions, recordings = [] }: { title: Title; editions: Edition[]; recordings?: RecordingLink[] }) {
  const targets: Target[] = [
    ...editions.map((e) => ({ id: e.id, label: e.label || e.file.format.toUpperCase(), kind: "edition" as const, titleId: e.titleId })),
    ...recordings.map((r) => ({ id: r.id, label: r.label || "Audiobook", kind: "recording" as const, titleId: "" })),
  ];
  const [id, setId] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === id) ?? targets[0];
  if (!target) return <Text tone="dim">This title has no files to edit.</Text>;
  return (
    <Stack>
      <CoverEditor title={title} editions={editions} recordings={recordings} />
      {targets.length > 1 && (
        <SegmentedField label="Edit" value={target.id} onValue={setId} items={targets.map((t) => ({ value: t.id, label: t.kind === "recording" ? `Audio: ${t.label}` : t.label }))} />
      )}
      <Editor key={target.id} target={target} />
    </Stack>
  );
}

function Editor({ target }: { target: Target }) {
  const qc = useQueryClient();
  const edition = target.kind === "edition";
  const base = edition ? `/admin/editions/${target.id}/metadata` : `/admin/recordings/${target.id}/metadata`;
  const key = ["admin", edition ? "edition-metadata" : "recording-metadata", target.id];
  const report = useQuery({ queryKey: key, queryFn: () => get<MetadataReport>(base), retry: false });
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: edition ? ["edition", target.id] : ["recording", target.id] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "title" });
    qc.invalidateQueries({ queryKey: ["titles"] });
  };
  const save = useMutation({
    mutationFn: async ({ clear }: { clear: boolean }): Promise<void> => {
      const value = clear ? null : parseValue(editing!, text);
      if (edition) await api<MetadataReport>("PUT", `${base}/${editing}`, { ...adminOp(report.data!.revision), clear, value });
      else await api<void>("PUT", `${base}/${editing}`, clear ? { clear: true } : { value });
    },
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: (field: string) => (edition ? api("DELETE", `${base}/${field}`, adminOp(report.data!.revision)) : api("DELETE", `${base}/${field}`)),
    onSettled: refresh,
  });

  if (report.isPending) return <Busy />;
  if (report.error instanceof ApiError && report.error.status === 403) return <Text tone="dim">Editing metadata needs an administrator account with access to this library.</Text>;
  if (report.error) return <ErrorBox error={report.error} />;
  const fields = FIELDS.filter((f) => !f.only || f.only === target.kind);
  const byField = new Map<string, MetadataField>(report.data.fields.map((f) => [f.field, f]));
  const open = (field: string) => { setText(show(byField.get(field)?.value)); setEditing(field); save.reset(); };
  const def = FIELDS.find((f) => f.field === editing);
  const failure = save.error ?? reset.error;
  const stale = failure instanceof ApiError && failure.status === 409;

  return (
    <Stack>
      <Text size="sm" tone="dim">An edit is protected: rescans and the files&apos; own tags will not overwrite it. Reset an edit to go back to what the files say.</Text>
      <Row gap="sm"><ProviderReview subject={{ kind: target.kind, id: target.id }} report={report.data} onApplied={refresh} /></Row>
      <Table label="Metadata" data-testid="metadata-table">
        <THead><TR><TH>Field</TH><TH>Value</TH><TH>Source</TH><TH>Actions</TH></TR></THead>
        <TBody>
          {fields.map((d) => {
            const f = byField.get(d.field);
            return (
              <TR key={d.field}>
                <TD>{d.label}</TD>
                <TD>
                  {f ? (f.cleared ? <Text as="span" size="sm" tone="dim">Deliberately empty</Text> : show(f.value)) : <Text as="span" size="sm" tone="dim">Not set</Text>}
                  {f?.conflicts?.map((c) => <Text key={c.source} size="xs" tone="dim">{sourceName(c.source)} says: {show(c.value)}</Text>)}
                </TD>
                <TD>{f && <Badge tone={sourceTone(f.source)}>{sourceName(f.source)}</Badge>}</TD>
                <TD>
                  <Row gap="xs">
                    <Button size="sm" onClick={() => open(d.field)} icon={icons.pencil}>Edit</Button>
                    {f?.source === "user" && <Button size="sm" loading={reset.isPending && reset.variables === d.field} onClick={() => reset.mutate(d.field)} icon={icons.reset}>Reset</Button>}
                  </Row>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {stale ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere, so the table was refreshed. Try again.</Text> : <ErrorBox error={reset.error} />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`Edit ${def?.label.toLowerCase() ?? "field"}`}
        description="Saved as a protected edit. The files are not changed."
        actions={
          <>
            <Button onClick={() => setEditing(null)} icon={icons.close}>Cancel</Button>
            {editing !== "title" && <Button loading={save.isPending} onClick={() => save.mutate({ clear: true })} icon={icons.close}>Leave empty</Button>}
            <Button variant="primary" disabled={!text.trim()} loading={save.isPending} onClick={() => save.mutate({ clear: false })} icon={icons.save}>Save</Button>
          </>
        }>
        {def?.kind === "list" || def?.kind === "multiline"
          ? <TextAreaField label={def.kind === "list" ? `${def.label} (one per line or comma separated)` : def.label} description={def.hint} value={text} onValue={setText} rows={def.kind === "multiline" ? 8 : 4} />
          : <TextField label={def?.label ?? "Value"} description={def?.hint} value={text} onValue={setText} inputMode={def?.kind === "integer" || def?.kind === "number" ? "decimal" : undefined} />}
        {stale ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere. Close and try again.</Text> : <ErrorBox error={save.error} />}
      </Modal>
    </Stack>
  );
}
