import { Anchor, Badge, Button, Card, Checkbox, Code, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, get } from "../api/client";
import type { Library, LibraryDetail, Page, Review, ScanRun } from "../api/types";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";
import { ImportSection, WritebackSection } from "./ImportSection";

export function LibrariesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const [name, setName] = useState("");
  const [mode, setMode] = useState<string | null>("managed");
  const [root, setRoot] = useState("");
  const create = useMutation({
    mutationFn: () => api<LibraryDetail>("POST", "/admin/libraries", {
      name, config: { mode, rootPath: root, followSymlinks: false, writebackBackups: false, providerOrder: [] } }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["libraries"] }); nav(`/admin/libraries/${d.library.id}`); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Stack>
      <Card withBorder>
        <form onSubmit={submit}>
          <Stack gap="xs">
            <Title order={4}>New library</Title>
            <Group grow align="flex-end">
              <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={200} />
              <Select label="Mode" allowDeselect={false} value={mode} onChange={setMode}
                data={[{ value: "managed", label: "Managed (Litara may organize files)" }, { value: "index", label: "Index only" }]} />
            </Group>
            <TextInput label="Root folder on the server" description="An absolute path inside the configured media root. Nothing is created or deleted here." value={root} onChange={(e) => setRoot(e.currentTarget.value)} required />
            <ErrorBox error={create.error} />
            <Group><Button type="submit" loading={create.isPending}>Create library</Button></Group>
          </Stack>
        </form>
      </Card>
      <Text size="sm" c="dimmed">You see libraries you have been granted. After creating one, grant yourself access under Users to manage it.</Text>
      {libs.isPending ? <Busy /> : libs.data?.items.map((l) => (
        <Card key={l.id} withBorder><Anchor component={Link} to={`/admin/libraries/${l.id}`} fw={600}>{l.name}</Anchor></Card>
      ))}
    </Stack>
  );
}

const ACTIONS: Record<string, string[]> = {
  move: ["keep_separate", "move"], ordering: ["order"], grouping: ["keep_separate", "link", "group_as_one"], association: ["choose"],
};

function ReviewRow({ lib, r }: { lib: string; r: Review }) {
  const qc = useQueryClient();
  const actions = ACTIONS[r.kind] ?? [];
  const [action, setAction] = useState<string | null>(actions[0] ?? null);
  const [f, setF] = useState({ missingFileId: "", newPath: "", titleId: "", path: "", index: "0", files: "" });
  const resolve = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { action };
      if (action === "move") { body.missingFileId = f.missingFileId; body.newPath = f.newPath; }
      if (action === "link") body.titleId = f.titleId;
      if (action === "choose") { body.path = f.path; body.index = Number(f.index); }
      if (action === "order") body.files = f.files.split(/\s+/).filter(Boolean);
      return api<void>("POST", `/admin/libraries/${lib}/reviews/${r.id}/resolve`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "reviews", lib] }),
  });
  return (
    <Card withBorder data-testid="review-item">
      <Stack gap="xs">
        <Group justify="space-between"><Badge>{r.kind}</Badge><Text size="xs" c="dimmed">{new Date(r.createdAt).toLocaleString()}</Text></Group>
        <Text size="sm" fw={500} style={{ wordBreak: "break-all" }}>{r.subjectKey}</Text>
        <Code block style={{ maxHeight: 160, overflow: "auto" }}>{JSON.stringify(r.candidates, null, 2)}</Code>
        {actions.length === 0 ? <Text size="sm" c="dimmed">This kind of review is resolved elsewhere.</Text> : (
          <Group align="flex-end" gap="xs">
            <Select size="xs" label="Decision" allowDeselect={false} value={action} onChange={setAction} data={actions} />
            {action === "move" && <><TextInput size="xs" label="Missing file ID" value={f.missingFileId} onChange={(e) => setF({ ...f, missingFileId: e.currentTarget.value })} /><TextInput size="xs" label="New path" value={f.newPath} onChange={(e) => setF({ ...f, newPath: e.currentTarget.value })} /></>}
            {action === "link" && <TextInput size="xs" label="Title ID" value={f.titleId} onChange={(e) => setF({ ...f, titleId: e.currentTarget.value })} />}
            {action === "choose" && <><TextInput size="xs" label="Path" value={f.path} onChange={(e) => setF({ ...f, path: e.currentTarget.value })} /><NumberInput size="xs" label="Candidate index" min={0} max={4} value={f.index} onChange={(v) => setF({ ...f, index: String(v) })} /></>}
            {action === "order" && <TextInput size="xs" label="File IDs in order (space separated)" value={f.files} onChange={(e) => setF({ ...f, files: e.currentTarget.value })} />}
            <Button size="xs" loading={resolve.isPending} onClick={() => resolve.mutate()}>Resolve</Button>
          </Group>
        )}
        <ErrorBox error={resolve.error} />
      </Stack>
    </Card>
  );
}

export function LibraryAdminPage() {
  const { libraryId = "" } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["admin", "library", libraryId], queryFn: () => get<LibraryDetail>(`/admin/libraries/${libraryId}`) });
  const scans = useQuery({ queryKey: ["admin", "scans", libraryId], queryFn: () => get<{ items: ScanRun[] }>(`/admin/libraries/${libraryId}/scans`), refetchInterval: 5000 });
  const reviews = useQuery({ queryKey: ["admin", "reviews", libraryId], queryFn: () => get<{ items: Review[] }>(`/admin/libraries/${libraryId}/reviews`) });
  const [verify, setVerify] = useState(false);
  const start = useMutation({
    mutationFn: () => api<ScanRun>("POST", `/admin/libraries/${libraryId}/scans`, { verify }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "scans", libraryId] }),
  });
  if (detail.isPending) return <Busy />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const d = detail.data;
  return (
    <Stack>
      <Group justify="space-between"><Title order={3}>{d.library.name}</Title>
        <Badge color={d.health.state === "healthy" ? "green" : "red"} variant="light">root {d.health.state}</Badge></Group>
      <Card withBorder>
        <Stack gap={2}>
          <Text size="sm">Mode: {d.config.mode} · follow symlinks: {String(d.config.followSymlinks)} · in-file write backups: {d.config.writebackBackups ? "on" : "off"}</Text>
          <Text size="sm" style={{ wordBreak: "break-all" }}>Root: <Code>{d.config.rootPath}</Code></Text>
          {d.health.detail && <Text size="sm" c="dimmed">{d.health.detail}</Text>}
          <Text size="xs" c="dimmed">Configuration editing is not in the web app yet.</Text>
        </Stack>
      </Card>

      <Title order={4}>Scans</Title>
      <Group>
        <Button loading={start.isPending} onClick={() => start.mutate()}>Scan now</Button>
        <Checkbox label="Also re-hash every file (verify)" checked={verify} onChange={(e) => setVerify(e.currentTarget.checked)} />
      </Group>
      <ErrorBox error={start.error ?? scans.error} />
      <ScrollRegion label="Scan runs">
        <Table verticalSpacing="xs" data-testid="scans-table">
          <Table.Thead><Table.Tr><Table.Th>Started</Table.Th><Table.Th>Trigger</Table.Th><Table.Th>State</Table.Th><Table.Th>Files</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {scans.data?.items.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{new Date(s.createdAt).toLocaleString()}</Table.Td><Table.Td>{s.trigger}</Table.Td>
                <Table.Td><Badge variant="light" color={s.state === "failed" ? "red" : s.state === "completed" ? "green" : "gray"}>{s.state}</Badge>{s.failure && <Text size="xs" c="red">{s.failure}</Text>}</Table.Td>
                <Table.Td>{s.filesSeen}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollRegion>

      <Title order={4}>Reviews</Title>
      {reviews.isPending ? <Busy /> : reviews.data?.items.length === 0 ? <Text c="dimmed">Nothing needs review.</Text> :
        reviews.data?.items.map((r) => <ReviewRow key={r.id} lib={libraryId} r={r} />)}
      <ImportSection libraryId={libraryId} />
      <WritebackSection backupsOn={d.config.writebackBackups} />
      <Text size="xs" c="dimmed">Provider lookups are not in the web app yet.</Text>
    </Stack>
  );
}
