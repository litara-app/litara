import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api, get } from "../api/client";
import type { Library, LibraryDetail, Page, Review, ScanRun } from "../api/types";
import { icons, IconPicker, LIBRARY_ICONS, libraryIcon, Badge, Busy, Button, Card, CheckboxField, Code, CodeBlock, EmptyState, ErrorBox, Heading, NumberField, PageHeader, Row, SelectField, Stack, Table, TBody, TD, Text, TextField, TextLink, TH, THead, TR, type Tone } from "../ui";
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
      <Card>
        <form onSubmit={submit}>
          <Stack gap="sm">
            <Heading level={2}>New library</Heading>
            <Row grow align="end">
              <TextField label="Name" value={name} onValue={setName} required maxLength={200} />
              <SelectField label="Mode" value={mode} onValue={setMode}
                items={[{ value: "managed", label: "Managed (Litara may organize files)" }, { value: "index", label: "Index only" }]} />
            </Row>
            <TextField label="Root folder on the server" description="An absolute path inside the configured media root. Nothing is created or deleted here." value={root} onValue={setRoot} required />
            <ErrorBox error={create.error} />
            <Row><Button type="submit" variant="primary" loading={create.isPending} icon={icons.plus}>Create library</Button></Row>
          </Stack>
        </form>
      </Card>
      <Text size="sm" tone="dim">You see libraries you have been granted. After creating one, grant yourself access under Users to manage it.</Text>
      {libs.isPending ? <Busy /> : libs.data?.items.length === 0 ? <EmptyState title="No libraries yet">Create one above.</EmptyState> : libs.data?.items.map((l) => (
        <Card key={l.id} pad="sm"><TextLink to={`/admin/libraries/${l.id}`}>{l.name}</TextLink></Card>
      ))}
    </Stack>
  );
}

const ACTIONS: Record<string, string[]> = {
  move: ["keep_separate", "move"], ordering: ["order"], association: ["choose"],
};

/** What the server accepts depends on what the review is about: a work that looks like an existing title can be kept
 *  separate or linked; files of one folder that name different albums can only be grouped as one recording. */
function actionsFor(r: Review): string[] {
  if (r.kind === "grouping") return r.subjectKey.startsWith("title:") || r.subjectKey.startsWith("edition-title:") ? ["keep_separate", "link"] : ["group_as_one"];
  return ACTIONS[r.kind] ?? [];
}

function ReviewRow({ lib, r }: { lib: string; r: Review }) {
  const qc = useQueryClient();
  const actions = actionsFor(r);
  const [action, setAction] = useState<string | null>(actions[0] ?? null);
  const [f, setF] = useState({ missingFileId: "", newPath: "", titleId: "", path: "", index: 0, files: "" });
  const resolve = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { action };
      if (action === "move") { body.missingFileId = f.missingFileId; body.newPath = f.newPath; }
      if (action === "link") body.titleId = f.titleId;
      if (action === "choose") { body.path = f.path; body.index = f.index; }
      if (action === "order") body.files = f.files.split(/\s+/).filter(Boolean);
      return api<void>("POST", `/admin/libraries/${lib}/reviews/${r.id}/resolve`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "reviews", lib] }),
  });
  return (
    <Card data-testid="review-item">
      <Stack gap="sm">
        <Row justify="between"><Badge>{r.kind}</Badge><Text size="xs" tone="dim">{new Date(r.createdAt).toLocaleString()}</Text></Row>
        <Text size="sm" strong>{r.subjectKey}</Text>
        <CodeBlock label="Details (scrollable)">{JSON.stringify(r.candidates, null, 2)}</CodeBlock>
        {actions.length === 0 ? <Text size="sm" tone="dim">This kind of review is resolved elsewhere.</Text> : (
          <Row align="end" wrap>
            <SelectField label="Decision" value={action} onValue={setAction} items={actions.map((a) => ({ value: a, label: a }))} />
            {action === "move" && <><TextField label="Missing file ID" value={f.missingFileId} onValue={(v) => setF({ ...f, missingFileId: v })} /><TextField label="New path" value={f.newPath} onValue={(v) => setF({ ...f, newPath: v })} /></>}
            {action === "link" && <TextField label="Title ID" value={f.titleId} onValue={(v) => setF({ ...f, titleId: v })} />}
            {action === "choose" && <><TextField label="Path" value={f.path} onValue={(v) => setF({ ...f, path: v })} /><NumberField label="Candidate index" min={0} max={4} step={1} value={f.index} onValue={(v) => setF({ ...f, index: v ?? 0 })} /></>}
            {action === "order" && <TextField label="File IDs in order (space separated)" value={f.files} onValue={(v) => setF({ ...f, files: v })} />}
            <Button variant="primary" size="sm" loading={resolve.isPending} onClick={() => resolve.mutate()} icon={icons.check}>Resolve</Button>
          </Row>
        )}
        <ErrorBox error={resolve.error} />
      </Stack>
    </Card>
  );
}

const scanTone = (s: string): Tone => (s === "failed" ? "danger" : s === "completed" ? "success" : "neutral");

/** Which icon a library shows in the sidebar. It is shared: everyone with access to the library sees the choice. */
function IconCard({ libraryId, icon }: { libraryId: string; icon: string | null }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string | null) => api<Library>("PUT", `/admin/libraries/${libraryId}/icon`, { icon: next }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["libraries"] }); qc.invalidateQueries({ queryKey: ["admin", "library", libraryId] }); },
  });
  const chosen = LIBRARY_ICONS.find((i) => i.value === icon)?.value ?? LIBRARY_ICONS[0]!.value;
  return (
    <Card framed>
      <Stack gap="sm">
        <Row><span className="lt-btn-icon" aria-hidden="true">{libraryIcon(icon)}</span><Heading level={2}>Sidebar icon</Heading></Row>
        <Text size="sm" tone="dim">Shown beside this library in the sidebar for everyone who can open it.</Text>
        <IconPicker label="Library icon" value={chosen} options={LIBRARY_ICONS} disabled={save.isPending} onValue={(v) => save.mutate(v)} />
        <Row>
          <Button size="sm" icon={icons.close} disabled={icon === null || save.isPending} onClick={() => save.mutate(null)}>Use the default icon</Button>
        </Row>
        <ErrorBox error={save.error} />
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
      <PageHeader title={d.library.name} actions={<Badge tone={d.health.state === "healthy" ? "success" : "danger"}>root {d.health.state}</Badge>} />
      <Card framed>
        <Stack gap="xs">
          <Text size="sm">Mode: {d.config.mode} · follow symlinks: {String(d.config.followSymlinks)} · in-file write backups: {d.config.writebackBackups ? "on" : "off"}</Text>
          <Text size="sm">Root: <Code>{d.config.rootPath}</Code></Text>
          {d.health.detail && <Text size="sm" tone="dim">{d.health.detail}</Text>}
          <Text size="xs" tone="dim">Configuration editing is not in the web app yet.</Text>
        </Stack>
      </Card>

      <IconCard libraryId={libraryId} icon={d.library.icon} />

      <Heading level={2}>Scans</Heading>
      <Row>
        <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()} icon={icons.sync}>Scan now</Button>
        <CheckboxField label="Also re-hash every file (verify)" checked={verify} onChange={setVerify} />
      </Row>
      <ErrorBox error={start.error ?? scans.error} />
      <Table label="Scan runs" data-testid="scans-table">
        <THead><TR><TH>Started</TH><TH>Trigger</TH><TH>State</TH><TH num>Files</TH></TR></THead>
        <TBody>
          {scans.data?.items.map((s) => (
            <TR key={s.id}>
              <TD>{new Date(s.createdAt).toLocaleString()}</TD><TD>{s.trigger}</TD>
              <TD><Badge tone={scanTone(s.state)}>{s.state}</Badge>{s.failure && <Text size="xs" tone="danger">{s.failure}</Text>}</TD>
              <TD num>{s.filesSeen}</TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Heading level={2}>Reviews</Heading>
      {reviews.isPending ? <Busy /> : reviews.data?.items.length === 0 ? <EmptyState title="Nothing needs review" /> :
        reviews.data?.items.map((r) => <ReviewRow key={r.id} lib={libraryId} r={r} />)}
      <ImportSection libraryId={libraryId} />
      <WritebackSection backupsOn={d.config.writebackBackups} />
      <Text size="xs" tone="dim">Provider lookups are not in the web app yet.</Text>
    </Stack>
  );
}
