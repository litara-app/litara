import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminOp, api, ApiError, get, qs } from "../api/client";
import type { Edition, MetadataReport, Page, Title as TitleT } from "../api/types";
import { icons, Badge, Busy, Button, Card, ErrorBox, Grow, Heading, Row, SelectField, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR, type Tone } from "../ui";

const FIELDS = ["title", "authors", "series_name", "series_index", "language", "tags"].map((v) => ({ value: v, label: v }));
const LISTS = new Set(["authors", "tags"]);

function show(v: unknown): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

function parseValue(field: string, text: string): unknown {
  if (LISTS.has(field)) return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (field === "series_index") return Number(text);
  return text;
}

const sourceTone = (s: string): Tone => (s === "user" ? "info" : s === "filename" ? "neutral" : "success");

/** Administrator tools for one edition: metadata with provenance, and title linking. */
export function EditionAdmin({ edition }: { edition: Edition }) {
  const qc = useQueryClient();
  const key = ["admin", "edition-metadata", edition.id];
  const report = useQuery({ queryKey: key, queryFn: () => get<MetadataReport>(`/admin/editions/${edition.id}/metadata`), retry: false });
  const [field, setField] = useState<string | null>("title");
  const [text, setText] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["edition", edition.id] }); qc.invalidateQueries({ queryKey: ["titles"] }); };
  const write = useMutation({
    mutationFn: ({ clear }: { clear: boolean }) =>
      api<MetadataReport>("PUT", `/admin/editions/${edition.id}/metadata/${field}`, { ...adminOp(report.data!.revision), clear, value: clear ? null : parseValue(field!, text) }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api<MetadataReport>("DELETE", `/admin/editions/${edition.id}/metadata/${field}`, adminOp(report.data!.revision)),
    onSettled: refresh,
  });

  const [q, setQ] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const titles = useQuery({
    queryKey: ["admin", "link-candidates", edition.libraryId, q], enabled: q.length >= 2,
    queryFn: () => get<Page<TitleT>>(`/titles${qs({ q, libraryId: edition.libraryId, size: 10 })}`),
  });
  const link = useMutation({
    mutationFn: (titleId: string | null) => api<Edition>("PUT", `/admin/editions/${edition.id}/title`, { ...adminOp(report.data!.revision), titleId }),
    onSuccess: (e) => { setTarget(null); refresh(); qc.invalidateQueries({ queryKey: ["title", e.titleId] }); },
  });

  const forbidden = report.error instanceof ApiError && report.error.status === 403;
  if (report.isPending) return <Busy />;
  if (forbidden) return <Text size="sm" tone="dim">Administrator tools need an administrator account with access to this edition&apos;s library.</Text>;
  if (report.error) return <ErrorBox error={report.error} />;
  const mutationError = write.error ?? remove.error ?? link.error;
  const staleMsg = mutationError instanceof ApiError && mutationError.status === 409;

  return (
    <Card data-testid="edition-admin">
      <Stack>
        <Row justify="between"><Heading level={2}>Administrator tools</Heading><Badge>edition revision {report.data.revision}</Badge></Row>
        <Table label="Metadata table" data-testid="metadata-table">
          <THead><TR><TH>Field</TH><TH>Effective value</TH><TH>Source</TH><TH>Other evidence</TH></TR></THead>
          <TBody>
            {report.data.fields.map((f) => (
              <TR key={f.field}>
                <TD>{f.field}</TD>
                <TD>{f.cleared ? <Text size="sm" tone="dim">(deliberately empty)</Text> : show(f.value)}</TD>
                <TD><Badge tone={sourceTone(f.source)}>{f.source}</Badge></TD>
                <TD>{f.conflicts?.map((c) => <Text key={c.source} size="xs" tone="dim">{c.source}: {show(c.value)}</Text>)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>

        <Row align="end" wrap>
          <SelectField label="Field" value={field} onValue={setField} items={FIELDS} />
          <Grow><TextField label={LISTS.has(field ?? "") ? "Values (comma or line separated)" : "Value"} value={text} onValue={setText} /></Grow>
          <Button variant="primary" size="sm" disabled={!text.trim()} loading={write.isPending} onClick={() => write.mutate({ clear: false })} icon={icons.save}>Set (protected)</Button>
          <Button size="sm" disabled={field === "title"} loading={write.isPending} onClick={() => write.mutate({ clear: true })} icon={icons.check}>Protected clear</Button>
          <Button size="sm" loading={remove.isPending} onClick={() => remove.mutate()} icon={icons.trash}>Remove my override</Button>
        </Row>
        <Text size="xs" tone="dim">A protected edit or clear survives rescans. Removing the override lets embedded and other sources apply again. Metadata edits never change the book file.</Text>

        <Heading level={3}>Title link</Heading>
        <Row align="end" wrap>
          <TextField label="Find a title in this library" value={q} onValue={setQ} />
          <SelectField label="Matching titles" placeholder="Choose title" value={target} onValue={setTarget}
            items={(titles.data?.items ?? []).filter((t) => t.id !== edition.titleId).map((t) => ({ value: t.id, label: `${t.title} — ${t.authors.join(", ")}` }))} />
          <Button variant="primary" size="sm" disabled={!target} loading={link.isPending} onClick={() => link.mutate(target)} icon={icons.plus}>Link to this title</Button>
          <Button size="sm" loading={link.isPending} onClick={() => link.mutate(null)} icon={icons.plus}>Separate into its own title</Button>
        </Row>
        <Text size="xs" tone="dim">Linking changes only which title lists this edition. Files and every account&apos;s reading state stay as they are.</Text>
        {staleMsg ? <Text size="sm" tone="warning" role="alert">The edition changed elsewhere; the list was refreshed. Try again.</Text> : <ErrorBox error={mutationError} />}
      </Stack>
    </Card>
  );
}
