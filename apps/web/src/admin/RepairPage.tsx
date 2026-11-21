import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, get, qs } from "../api/client";
import type { Page, RecordingFile, RecordingSnapshot, RepairPlan, Title as TitleT } from "../api/types";
import { icons, Alert, Badge, Busy, Button, Card, CheckboxField, ConfirmDialog, ErrorBox, Heading, IconButton, NumberField, PageHeader, Row, SegmentedField, SelectField, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR, type Tone } from "../ui";

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
      <Alert tone="info" title="Reviewed changes only">
        A repair never edits files. Sources become retired records that keep every account&apos;s progress and history; new recordings take their files, start unfinished, and offer each reader their old place as a choice.
      </Alert>
      <Row align="end" wrap>
        <TextField label="Find an audiobook title" value={q} onValue={setQ} />
        <SelectField label="Title" placeholder="Choose title" value={titleId} onValue={(v) => { setTitleId(v); setPicked([]); }}
          items={(titles.data?.items ?? []).map((t) => ({ value: t.id, label: t.title }))} />
        <SegmentedField label="Repair kind" value={kind} onValue={(v) => { setKind(v as "merge" | "split"); setPicked([]); }} items={[{ value: "merge", label: "Merge" }, { value: "split", label: "Split" }]} />
      </Row>
      {recs.isPending && titleId && <Busy />}
      {recs.data && (
        <Stack gap="xs">
          <Text size="sm" strong>{kind === "merge" ? "Choose two or more recordings to merge" : "Choose the one recording to split"}</Text>
          {recs.data.items.map((r) => (
            <CheckboxField key={r.id} label={r.label || r.id} checked={picked.includes(r.id)}
              onChange={(on) => setPicked((p) => (on ? (kind === "split" ? [r.id] : [...p, r.id]) : p.filter((x) => x !== r.id)))} />
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
  if (sources.length < 2) return <Text size="sm" tone="dim">Choose at least two recordings.</Text>;
  return (
    <Card>
      <Stack>
        <Heading level={2}>Merged recording</Heading>
        <TextField label="Label" value={label} onValue={setLabel} required />
        <Text size="sm" tone="dim">Order the files as they should play.</Text>
        {files.map((f, i) => (
          <Row key={f.id} gap="xs" data-testid="merge-file">
            <IconButton aria-label={`Move ${f.filename} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
            <IconButton aria-label={`Move ${f.filename} down`} disabled={i === files.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
            <Text as="span" size="sm">{i + 1}. {f.filename}</Text>
          </Row>
        ))}
        <ErrorBox error={plan.error} />
        <Row><Button variant="primary" disabled={!label.trim()} loading={plan.isPending}
          onClick={() => plan.mutate({ operationId: crypto.randomUUID(), kind: "merge", sources: srcRefs(sources), outputs: [{ key: "merged", label, files: files.map(fileRef) }] })} icon={icons.plus}>Create plan</Button></Row>
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
    <Card>
      <Stack>
        <Heading level={2}>Split into parts</Heading>
        <Text size="sm" tone="dim">Give each file a part number. Files keep their current order within a part.</Text>
        {source.files.map((f, i) => (
          <Row key={f.id} data-testid="split-file">
            <NumberField label={<span className="lt-sr">Part for {f.filename}</span>} min={1} max={20} step={1} value={part[i]}
              onValue={(v) => setPart((p) => p.map((x, j) => (j === i ? v || 1 : x)))} />
            <Text as="span" size="sm">{f.filename}</Text>
          </Row>
        ))}
        {parts.map((p) => <TextField key={p} label={`Label for part ${p}`} value={labels[p] ?? ""} onValue={(v) => setLabels({ ...labels, [p]: v })} />)}
        {parts.length < 2 && <Text size="sm" tone="warning">Use at least two different part numbers.</Text>}
        <ErrorBox error={plan.error} />
        <Row><Button variant="primary" disabled={!valid} loading={plan.isPending}
          onClick={() => plan.mutate({ operationId: crypto.randomUUID(), kind: "split", sources: srcRefs([source]), outputs })} icon={icons.plus}>Create plan</Button></Row>
      </Stack>
    </Card>
  );
}

const stateTone: Record<RepairPlan["state"], Tone> = { planned: "info", approved: "info", applied: "success", cancelled: "neutral", stale: "warning" };

export function RepairPlanPage() {
  const { planId = "" } = useParams();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
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
      <PageHeader title={`Repair plan (${p.kind})`} actions={<Badge tone={stateTone[p.state]} data-testid="plan-state">{p.state}</Badge>} />
      {p.state === "stale" && <Alert tone="warning" title="This plan is obsolete">A source changed or was already repaired. Nothing was applied. Create a new plan.</Alert>}
      {p.warnings.map((w) => <Alert key={w.code} tone="info">{w.detail}</Alert>)}
      <Text size="sm">{p.sources.length} source recording{p.sources.length === 1 ? "" : "s"} → {p.outputs.length} new recording{p.outputs.length === 1 ? "" : "s"}.</Text>
      {p.outputs.map((o) => (
        <Card key={o.key} data-testid="plan-output" pad="sm"><Row justify="between"><Text strong>{o.label}</Text><Badge>{o.files.length} file{o.files.length === 1 ? "" : "s"}</Badge></Row></Card>
      ))}
      <ErrorBox error={step.error} />
      <Row>
        {p.state === "planned" && <Button variant="primary" loading={step.isPending} onClick={() => step.mutate("approve")} icon={icons.check}>Approve</Button>}
        {p.state === "approved" && <Button variant="danger" solid loading={step.isPending} onClick={() => setConfirming(true)} icon={icons.check}>Apply repair</Button>}
        {(p.state === "planned" || p.state === "approved") && <Button loading={step.isPending} onClick={() => step.mutate("cancel")} icon={icons.close}>Cancel plan</Button>}
        <Button variant="subtle" to="/admin/repairs" icon={icons.plus}>New plan</Button>
      </Row>
      <ConfirmDialog open={confirming} title="Apply this repair?" confirmLabel="Apply repair" danger
        onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); step.mutate("execute"); }}>
        The source recordings will be retired. Their files stay on disk and every account keeps its history, but this cannot be undone.
      </ConfirmDialog>
      {p.state === "applied" && (
        <Table data-testid="plan-result">
          <THead><TR><TH>Part</TH><TH>New recording ID</TH></TR></THead>
          <TBody>{p.result.map((r) => <TR key={r.key}><TD>{r.key}</TD><TD><Text as="span" size="sm" mono>{r.recordingId}</Text></TD></TR>)}</TBody>
        </Table>
      )}
    </Stack>
  );
}
