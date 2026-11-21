import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, get } from "../api/client";
import { icons, Alert, Badge, Button, Card, Code, CodeBlock, ErrorBox, Grow, Heading, Row, Stack, SwitchField, Table, TBody, TD, Text, TextField, TH, THead, TR, type Tone } from "../ui";

interface ImportItem { id: string; sourceRel: string; sizeBytes: number; targetRel: string; suffixed: boolean; duplicateOf?: string; decision: "pending" | "import" | "skip"; state: string; detail?: string }
interface ImportPlan { id: string; libraryId: string; sourcePath: string; state: string; items: ImportItem[] }
interface Writeback { id: string; kind: string; format?: string; target: string; stage: string; detail?: string; backedUp: boolean; diff: unknown }

const stateTone: Record<string, Tone> = { planned: "info", approved: "info", running: "warning", completed: "success", failed: "danger", cancelled: "neutral" };

/** Copy-only import: preview, per-item decisions, approval, then execution (ADR-0049/0050). */
export function ImportSection({ libraryId }: { libraryId: string }) {
  const qc = useQueryClient();
  const [source, setSource] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const base = `/admin/libraries/${libraryId}/imports`;
  const plan = useQuery({
    queryKey: ["admin", "import", planId], enabled: !!planId, queryFn: () => get<ImportPlan>(`${base}/${planId}`),
    refetchInterval: (q) => (q.state.data?.state === "running" || q.state.data?.state === "approved" ? 1500 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "import", planId] });
  const create = useMutation({ mutationFn: () => api<ImportPlan>("POST", base, { sourcePath: source }), onSuccess: (p) => setPlanId(p.id) });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: string }) => api<void>("PUT", `${base}/${planId}/items/${id}`, { decision }), onSettled: refresh });
  const approve = useMutation({ mutationFn: () => api<ImportPlan>("POST", `${base}/${planId}/approve`), onSettled: refresh });
  const execute = useMutation({ mutationFn: () => api<unknown>("POST", `${base}/${planId}/execute`), onSettled: refresh });
  const p = plan.data;
  return (
    <Stack>
      <Heading level={2}>Import (copy only)</Heading>
      <Text size="sm" tone="dim">Files are copied into this library; the source folder is read-only and never modified. Nothing is copied until you approve and run the plan.</Text>
      <Row align="end">
        <Grow><TextField label="Source folder on the server" placeholder="/path/to/folder" value={source} onValue={setSource} /></Grow>
        <Button disabled={!source.trim()} loading={create.isPending} onClick={() => create.mutate()} icon={icons.external}>Preview import</Button>
      </Row>
      <ErrorBox error={create.error ?? plan.error ?? decide.error ?? approve.error ?? execute.error} />
      {p && (
        <Card data-testid="import-plan">
          <Stack gap="sm">
            <Row justify="between"><Text strong>Plan for <Code>{p.sourcePath}</Code></Text>
              <Badge tone={stateTone[p.state] ?? "neutral"} data-testid="import-state">{p.state}</Badge></Row>
            {p.items.length === 0 && <Text tone="dim">No importable files were found.</Text>}
            <Table label="Import items">
              <THead><TR><TH>From</TH><TH>To</TH><TH>Size</TH><TH>Decision</TH><TH>State</TH></TR></THead>
              <TBody>
                {p.items.map((i) => (
                  <TR key={i.id} data-testid="import-item">
                    <TD>{i.sourceRel}</TD>
                    <TD>{i.targetRel}{i.suffixed && <Badge tone="warning">renamed to avoid overwrite</Badge>}{i.duplicateOf && <Badge tone="warning">duplicate of a library file</Badge>}</TD>
                    <TD num>{i.sizeBytes} B</TD>
                    <TD>{p.state === "planned"
                      ? <SwitchField checked={i.decision !== "skip"} onChange={(v) => decide.mutate({ id: i.id, decision: v ? "import" : "skip" })}
                          label={<><span className="lt-sr">Import {i.sourceRel}: </span>{i.decision === "skip" ? "skip" : "import"}</>} />
                      : i.decision}</TD>
                    <TD>{i.state}{i.detail && <Text size="xs" tone="danger">{i.detail}</Text>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Row>
              {p.state === "planned" && <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()} icon={icons.check}>Approve plan</Button>}
              {p.state === "approved" && <Button variant="danger" solid loading={execute.isPending} onClick={() => execute.mutate()} icon={icons.check}>Copy files now</Button>}
              {p.state === "completed" && <Alert tone="success">Copied and verified. Run a scan to add them to the catalog.</Alert>}
            </Row>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

/** Metadata write-back status: in-file writers stay off until fidelity evidence exists (ADR-0052). */
export function WritebackSection({ backupsOn }: { backupsOn: boolean }) {
  const writers = useQuery({ queryKey: ["admin", "writers"], queryFn: () => get<{ items: { format: string; enabled: boolean }[] }>("/admin/writers") });
  const [rec, setRec] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = useQuery({ queryKey: ["admin", "writeback", planId], enabled: !!planId, queryFn: () => get<Writeback>(`/admin/writebacks/${planId}`) });
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "writeback", planId] });
  const create = useMutation({ mutationFn: () => api<Writeback>("POST", `/admin/recordings/${rec}/writebacks/sidecar`, {}), onSuccess: (w) => setPlanId(w.id) });
  const approve = useMutation({ mutationFn: () => api<Writeback>("POST", `/admin/writebacks/${planId}/approve`), onSettled: refresh });
  const run = useMutation({ mutationFn: () => api<Writeback>("POST", `/admin/writebacks/${planId}/execute`), onSettled: refresh });
  const w = plan.data;
  return (
    <Stack>
      <Heading level={2}>Metadata write-back</Heading>
      <Row gap="xs" wrap data-testid="writers">
        {writers.data?.items.map((x) => <Badge key={x.format} tone={x.enabled ? "success" : "neutral"}>{x.format}: in-file writing {x.enabled ? "on" : "off"}</Badge>)}
        <Badge outline tone="neutral">backups before replacing files: {backupsOn ? "on" : "off (default)"}</Badge>
      </Row>
      <Text size="sm" tone="dim">Editing metadata in Litara never changes your files. In-file writers are off until fidelity is proven per format; a sidecar JSON export is the safe alternative and needs your approval of the exact diff.</Text>
      <Row align="end">
        <Grow><TextField label="Recording ID for a sidecar export" value={rec} onValue={setRec} /></Grow>
        <Button disabled={!rec.trim()} loading={create.isPending} onClick={() => create.mutate()} icon={icons.external}>Preview sidecar</Button>
      </Row>
      <ErrorBox error={writers.error ?? create.error ?? plan.error ?? approve.error ?? run.error} />
      {w && (
        <Card data-testid="writeback-plan">
          <Stack gap="sm">
            <Row justify="between"><Text strong>{w.kind} to <Code>{w.target}</Code></Text><Badge data-testid="writeback-stage">{w.stage}</Badge></Row>
            <CodeBlock label="Details (scrollable)">{JSON.stringify(w.diff, null, 2)}</CodeBlock>
            {w.detail && <Text size="sm" tone="danger">{w.detail}</Text>}
            <Row>
              {w.stage === "planned" && <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()} icon={icons.check}>Approve exactly this diff</Button>}
              {w.stage === "approved" && <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()} icon={icons.pencil}>Write now</Button>}
            </Row>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
