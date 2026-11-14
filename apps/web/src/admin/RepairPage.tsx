import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, NumberInput, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, get, qs } from "../api/client";
import type { Page, RecordingFile, RecordingSnapshot, RepairPlan, Title as TitleT } from "../api/types";
import { Busy, ErrorBox } from "../ui/common";

interface RecLink { id: string; label: string }

/** Plan builder: merge or split recordings of one title (ADR-0070). */
export function RepairPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [titleId, setTitleId] = useState<string | null>(null);
  const [kind, setKind] = useState<"merge" | "split">("merge");
  const [picked, setPicked] = useState<string[]>([]);

  const titles = useQuery({ queryKey: ["admin", "repair-titles", q], enabled: q.length >= 2, queryFn: () => get<Page<TitleT>>(`/titles${qs({ q, mediaKind: "audio", size: 10 })}`) });
  const recs = useQuery({ queryKey: ["admin", "repair-recs", titleId], enabled: !!titleId, queryFn: () => get<Page<RecLink>>(`/titles/${titleId}/recordings?size=200`) });
  const snaps = useQueries({
    queries: picked.map((id) => ({ queryKey: ["admin", "repair-snap", id], queryFn: () => get<RecordingSnapshot>(`/recordings/${id}`) })),
  });
  const ready = snaps.length > 0 && snaps.every((s) => s.data);
  const sources = useMemo(() => snaps.map((s) => s.data).filter((x): x is RecordingSnapshot => !!x), [snaps.map((s) => s.data?.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack>
      <Alert color="blue" title="Reviewed changes only">
        A repair never edits files. Sources become retired records that keep every account&apos;s progress and history; new recordings take their files, start unfinished, and offer each reader their old place as a choice.
      </Alert>
      <Group align="flex-end">
        <TextInput label="Find an audiobook title" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Select placeholder="Choose title" value={titleId} onChange={(v) => { setTitleId(v); setPicked([]); }}
          data={(titles.data?.items ?? []).map((t) => ({ value: t.id, label: t.title }))} />
        <SegmentedControl value={kind} onChange={(v) => { setKind(v as "merge" | "split"); setPicked([]); }} data={[{ value: "merge", label: "Merge" }, { value: "split", label: "Split" }]} />
      </Group>
      {recs.isPending && titleId && <Busy />}
      {recs.data && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>{kind === "merge" ? "Choose two or more recordings to merge" : "Choose the one recording to split"}</Text>
          {recs.data.items.map((r) => (
            <Checkbox key={r.id} label={r.label || r.id} checked={picked.includes(r.id)}
              onChange={(e) => {
                const on = e.currentTarget.checked; // read now: the updater below runs after the event is released
                setPicked((p) => (on ? (kind === "split" ? [r.id] : [...p, r.id]) : p.filter((x) => x !== r.id)));
              }} />
          ))}
        </Stack>
      )}
      {picked.length > 0 && !ready && <Busy />}
      {ready && sources.length === picked.length && (kind === "merge"
        ? <MergeBuilder sources={sources} onDone={(id) => nav(`/admin/repairs/${id}`)} />
        : <SplitBuilder source={sources[0]} onDone={(id) => nav(`/admin/repairs/${id}`)} />)}
    </Stack>
  );
}

function fileRef(f: RecordingFile) { return { fileId: f.id, contentVersion: f.contentVersion }; }
const srcRefs = (s: RecordingSnapshot[]) => s.map((x) => ({ recordingId: x.id, layoutRevision: x.layoutRevision }));

function usePlan(onDone: (id: string) => void) {
  return useMutation({
    mutationFn: (body: unknown) => api<RepairPlan>("POST", "/admin/recording-repairs", body),
    onSuccess: (p) => onDone(p.id),
  });
}

function MergeBuilder({ sources, onDone }: { sources: RecordingSnapshot[]; onDone: (id: string) => void }) {
  const [files, setFiles] = useState<RecordingFile[]>(() => sources.flatMap((s) => s.files));
  const [label, setLabel] = useState("");
  const plan = usePlan(onDone);
  const move = (i: number, d: number) => setFiles((fs) => { const n = [...fs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  if (sources.length < 2) return <Text size="sm" c="dimmed">Choose at least two recordings.</Text>;
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Merged recording</Title>
        <TextInput label="Label" value={label} onChange={(e) => setLabel(e.currentTarget.value)} required />
        <Text size="sm" c="dimmed">Order the files as they should play.</Text>
        {files.map((f, i) => (
          <Group key={f.id} gap="xs" data-testid="merge-file">
            <ActionIcon variant="default" aria-label={`Move ${f.filename} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</ActionIcon>
            <ActionIcon variant="default" aria-label={`Move ${f.filename} down`} disabled={i === files.length - 1} onClick={() => move(i, 1)}>↓</ActionIcon>
            <Text size="sm">{i + 1}. {f.filename}</Text>
          </Group>
        ))}
        <ErrorBox error={plan.error} />
        <Group><Button disabled={!label.trim()} loading={plan.isPending}
          onClick={() => plan.mutate({ operationId: crypto.randomUUID(), kind: "merge", sources: srcRefs(sources), outputs: [{ key: "merged", label, files: files.map(fileRef) }] })}>Create plan</Button></Group>
      </Stack>
    </Card>
  );
}

function SplitBuilder({ source, onDone }: { source: RecordingSnapshot; onDone: (id: string) => void }) {
  const [part, setPart] = useState<number[]>(() => source.files.map((_, i) => (i === 0 ? 1 : 2)));
  const [labels, setLabels] = useState<Record<number, string>>({});
  const plan = usePlan(onDone);
  const parts = [...new Set(part)].sort((a, b) => a - b);
  const valid = parts.length >= 2 && parts.every((p) => (labels[p] ?? "").trim());
  const outputs = parts.map((p) => ({ key: `part-${p}`, label: labels[p] ?? "", files: source.files.filter((_, i) => part[i] === p).map(fileRef) }));
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Split into parts</Title>
        <Text size="sm" c="dimmed">Give each file a part number. Files keep their current order within a part.</Text>
        {source.files.map((f, i) => (
          <Group key={f.id} gap="xs" data-testid="split-file">
            <NumberInput w={80} size="xs" min={1} max={20} value={part[i]} aria-label={`Part for ${f.filename}`} onChange={(v) => setPart((p) => p.map((x, j) => (j === i ? Number(v) || 1 : x)))} />
            <Text size="sm">{f.filename}</Text>
          </Group>
        ))}
        {parts.map((p) => <TextInput key={p} size="xs" label={`Label for part ${p}`} value={labels[p] ?? ""} onChange={(e) => setLabels({ ...labels, [p]: e.currentTarget.value })} />)}
        {parts.length < 2 && <Text size="sm" c="orange">Use at least two different part numbers.</Text>}
        <ErrorBox error={plan.error} />
        <Group><Button disabled={!valid} loading={plan.isPending}
          onClick={() => plan.mutate({ operationId: crypto.randomUUID(), kind: "split", sources: srcRefs([source]), outputs })}>Create plan</Button></Group>
      </Stack>
    </Card>
  );
}

const stateColor = { planned: "blue", approved: "teal", applied: "green", cancelled: "gray", stale: "orange" } as const;

export function RepairPlanPage() {
  const { planId = "" } = useParams();
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["admin", "repair", planId], queryFn: () => get<RepairPlan>(`/admin/recording-repairs/${planId}`) });
  const step = useMutation({
    mutationFn: (name: "approve" | "execute" | "cancel") => api<RepairPlan>("POST", `/admin/recording-repairs/${planId}/${name}`,
      { operationId: crypto.randomUUID(), baseRevision: plan.data!.revision }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "repair", planId] }),
  });
  if (plan.isPending) return <Busy />;
  if (plan.error) return <ErrorBox error={plan.error} />;
  const p = plan.data;
  return (
    <Stack>
      <Group justify="space-between"><Title order={3}>Repair plan ({p.kind})</Title><Badge color={stateColor[p.state]} size="lg" data-testid="plan-state">{p.state}</Badge></Group>
      {p.state === "stale" && <Alert color="orange" title="This plan is obsolete">A source changed or was already repaired. Nothing was applied. Create a new plan.</Alert>}
      {p.warnings.map((w) => <Alert key={w.code} color="blue">{w.detail}</Alert>)}
      <Text size="sm">{p.sources.length} source recording{p.sources.length === 1 ? "" : "s"} → {p.outputs.length} new recording{p.outputs.length === 1 ? "" : "s"}.</Text>
      {p.outputs.map((o) => (
        <Card key={o.key} withBorder data-testid="plan-output"><Group justify="space-between"><Text fw={500}>{o.label}</Text><Badge variant="light">{o.files.length} file{o.files.length === 1 ? "" : "s"}</Badge></Group></Card>
      ))}
      <ErrorBox error={step.error} />
      <Group>
        {p.state === "planned" && <Button loading={step.isPending} onClick={() => step.mutate("approve")}>Approve</Button>}
        {p.state === "approved" && <Button color="red" loading={step.isPending} onClick={() => { if (confirm("Apply this repair? The source recordings will be retired.")) step.mutate("execute"); }}>Apply repair</Button>}
        {(p.state === "planned" || p.state === "approved") && <Button variant="default" loading={step.isPending} onClick={() => step.mutate("cancel")}>Cancel plan</Button>}
        <Button component={Link} to="/admin/repairs" variant="subtle">New plan</Button>
      </Group>
      {p.state === "applied" && (
        <Table data-testid="plan-result"><Table.Thead><Table.Tr><Table.Th>Part</Table.Th><Table.Th>New recording ID</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{p.result.map((r) => <Table.Tr key={r.key}><Table.Td>{r.key}</Table.Td><Table.Td><Text size="sm" ff="monospace">{r.recordingId}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      )}
    </Stack>
  );
}
