import { Alert, Badge, Button, Card, Code, Group, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, get } from "../api/client";
import { ErrorBox } from "../ui/common";
import { ScrollRegion } from "../ui/ScrollRegion";

interface ImportItem { id: string; sourceRel: string; sizeBytes: number; targetRel: string; suffixed: boolean; duplicateOf?: string; decision: "pending" | "import" | "skip"; state: string; detail?: string }
interface ImportPlan { id: string; libraryId: string; sourcePath: string; state: string; items: ImportItem[] }
interface Writeback { id: string; kind: string; format?: string; target: string; stage: string; detail?: string; backedUp: boolean; diff: unknown }

const stateColor: Record<string, string> = { planned: "blue", approved: "teal", running: "yellow", completed: "green", failed: "red", cancelled: "gray" };

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
      <Title order={4}>Import (copy only)</Title>
      <Text size="sm" c="dimmed">Files are copied into this library; the source folder is read-only and never modified. Nothing is copied until you approve and run the plan.</Text>
      <Group align="flex-end">
        <TextInput label="Source folder on the server" placeholder="/path/to/folder" value={source} onChange={(e) => setSource(e.currentTarget.value)} style={{ flex: 1, minWidth: 220 }} />
        <Button disabled={!source.trim()} loading={create.isPending} onClick={() => create.mutate()}>Preview import</Button>
      </Group>
      <ErrorBox error={create.error ?? plan.error ?? decide.error ?? approve.error ?? execute.error} />
      {p && (
        <Card withBorder data-testid="import-plan">
          <Stack gap="xs">
            <Group justify="space-between"><Text fw={500}>Plan for <Code>{p.sourcePath}</Code></Text>
              <Badge color={stateColor[p.state] ?? "gray"} data-testid="import-state">{p.state}</Badge></Group>
            {p.items.length === 0 && <Text c="dimmed">No importable files were found.</Text>}
            <ScrollRegion label="Import items">
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
                <thead><tr><th align="left">From</th><th align="left">To</th><th align="left">Size</th><th align="left">Decision</th><th align="left">State</th></tr></thead>
                <tbody>
                  {p.items.map((i) => (
                    <tr key={i.id} data-testid="import-item">
                      <td style={{ wordBreak: "break-all" }}>{i.sourceRel}</td>
                      <td style={{ wordBreak: "break-all" }}>{i.targetRel}{i.suffixed && <Badge ml={4} size="xs" color="orange" variant="light">renamed to avoid overwrite</Badge>}{i.duplicateOf && <Badge ml={4} size="xs" color="orange" variant="light">duplicate of a library file</Badge>}</td>
                      <td>{i.sizeBytes} B</td>
                      <td>{p.state === "planned"
                        ? <Switch size="sm" checked={i.decision !== "skip"} onChange={(e) => decide.mutate({ id: i.id, decision: e.currentTarget.checked ? "import" : "skip" })} label={i.decision === "skip" ? "skip" : "import"} aria-label={`Import ${i.sourceRel}`} />
                        : i.decision}</td>
                      <td>{i.state}{i.detail && <Text size="xs" c="red">{i.detail}</Text>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <Group>
              {p.state === "planned" && <Button loading={approve.isPending} onClick={() => approve.mutate()}>Approve plan</Button>}
              {p.state === "approved" && <Button color="red" loading={execute.isPending} onClick={() => execute.mutate()}>Copy files now</Button>}
              {p.state === "completed" && <Alert color="green">Copied and verified. Run a scan to add them to the catalog.</Alert>}
            </Group>
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
      <Title order={4}>Metadata write-back</Title>
      <Group gap="xs" data-testid="writers">
        {writers.data?.items.map((x) => <Badge key={x.format} color={x.enabled ? "green" : "gray"} variant="light">{x.format}: in-file writing {x.enabled ? "on" : "off"}</Badge>)}
        <Badge variant="outline" color="gray">backups before replacing files: {backupsOn ? "on" : "off (default)"}</Badge>
      </Group>
      <Text size="sm" c="dimmed">Editing metadata in Litara never changes your files. In-file writers are off until fidelity is proven per format; a sidecar JSON export is the safe alternative and needs your approval of the exact diff.</Text>
      <Group align="flex-end">
        <TextInput label="Recording ID for a sidecar export" value={rec} onChange={(e) => setRec(e.currentTarget.value)} style={{ flex: 1, minWidth: 220 }} />
        <Button disabled={!rec.trim()} loading={create.isPending} onClick={() => create.mutate()}>Preview sidecar</Button>
      </Group>
      <ErrorBox error={writers.error ?? create.error ?? plan.error ?? approve.error ?? run.error} />
      {w && (
        <Card withBorder data-testid="writeback-plan">
          <Stack gap="xs">
            <Group justify="space-between"><Text fw={500} style={{ wordBreak: "break-all" }}>{w.kind} to <Code>{w.target}</Code></Text><Badge data-testid="writeback-stage">{w.stage}</Badge></Group>
            <Code block tabIndex={0} role="region" aria-label="Details (scrollable)" style={{ maxHeight: 200, overflow: "auto" }}>{JSON.stringify(w.diff, null, 2)}</Code>
            {w.detail && <Text size="sm" c="red">{w.detail}</Text>}
            <Group>
              {w.stage === "planned" && <Button loading={approve.isPending} onClick={() => approve.mutate()}>Approve exactly this diff</Button>}
              {w.stage === "approved" && <Button loading={run.isPending} onClick={() => run.mutate()}>Write now</Button>}
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
