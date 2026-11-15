import { Badge, Button, Card, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminOp, api, ApiError, get, qs } from "../api/client";
import type { Edition, MetadataReport, Page, Title as TitleT } from "../api/types";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";

const FIELDS = ["title", "authors", "series_name", "series_index", "language", "tags"];
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
  if (forbidden) return <Text size="sm" c="dimmed">Administrator tools need an administrator account with access to this edition&apos;s library.</Text>;
  if (report.error) return <ErrorBox error={report.error} />;
  const mutationError = write.error ?? remove.error ?? link.error;
  const staleMsg = mutationError instanceof ApiError && mutationError.status === 409;

  return (
    <Card withBorder data-testid="edition-admin">
      <Stack>
        <Group justify="space-between"><Title order={4}>Administrator tools</Title><Badge variant="light">edition revision {report.data.revision}</Badge></Group>
        <ScrollRegion label="Metadata table">
          <Table verticalSpacing={4} data-testid="metadata-table">
            <Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Effective value</Table.Th><Table.Th>Source</Table.Th><Table.Th>Other evidence</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {report.data.fields.map((f) => (
                <Table.Tr key={f.field}>
                  <Table.Td>{f.field}</Table.Td>
                  <Table.Td>{f.cleared ? <Text size="sm" c="dimmed" fs="italic">(deliberately empty)</Text> : show(f.value)}</Table.Td>
                  <Table.Td><Badge variant="light" color={f.source === "user" ? "blue" : f.source === "filename" ? "gray" : "teal"}>{f.source}</Badge></Table.Td>
                  <Table.Td>{f.conflicts.map((c) => <Text key={c.source} size="xs" c="dimmed">{c.source}: {show(c.value)}</Text>)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollRegion>

        <Group align="flex-end" gap="xs">
          <Select size="xs" label="Field" allowDeselect={false} value={field} onChange={setField} data={FIELDS} />
          <TextInput size="xs" label={LISTS.has(field ?? "") ? "Values (comma or line separated)" : "Value"} value={text} onChange={(e) => setText(e.currentTarget.value)} style={{ flex: 1, minWidth: 160 }} />
          <Button size="xs" disabled={!text.trim()} loading={write.isPending} onClick={() => write.mutate({ clear: false })}>Set (protected)</Button>
          <Button size="xs" variant="default" disabled={field === "title"} loading={write.isPending} onClick={() => write.mutate({ clear: true })}>Protected clear</Button>
          <Button size="xs" variant="default" loading={remove.isPending} onClick={() => remove.mutate()}>Remove my override</Button>
        </Group>
        <Text size="xs" c="dimmed">A protected edit or clear survives rescans. Removing the override lets embedded and other sources apply again. Metadata edits never change the book file.</Text>

        <Title order={5}>Title link</Title>
        <Group align="flex-end" gap="xs">
          <TextInput size="xs" label="Find a title in this library" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <Select size="xs" placeholder="Choose title" searchable value={target} onChange={setTarget}
            data={(titles.data?.items ?? []).filter((t) => t.id !== edition.titleId).map((t) => ({ value: t.id, label: `${t.title} — ${t.authors.join(", ")}` }))} />
          <Button size="xs" disabled={!target} loading={link.isPending} onClick={() => link.mutate(target)}>Link to this title</Button>
          <Button size="xs" variant="default" loading={link.isPending} onClick={() => link.mutate(null)}>Separate into its own title</Button>
        </Group>
        <Text size="xs" c="dimmed">Linking changes only which title lists this edition. Files and every account&apos;s reading state stay as they are.</Text>
        {staleMsg ? <Text size="sm" c="orange" role="alert">The edition changed elsewhere; the list was refreshed. Try again.</Text> : <ErrorBox error={mutationError} />}
      </Stack>
    </Card>
  );
}
