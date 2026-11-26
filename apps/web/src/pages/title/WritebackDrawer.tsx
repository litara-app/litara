import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, ApiError, get } from "../../api/client";
import { Alert, Badge, Button, CodeBlock, Drawer, Row, Stack, Text, icons } from "../../ui";

export interface Writeback { id: string; kind: string; format?: string; target: string; stage: string; detail?: string; backedUp: boolean; diff: unknown }

const words = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

/**
 * The reviewed write every change to disk goes through (ADR-0048, ADR-0057): preview a plan, approve exactly that plan,
 * then run it. Nothing is written before the last step, and the server refuses a plan whose target changed after review.
 */
export function WritebackDrawer({ title, description, intro, done, testId, showDiff, start, onClose }: {
  title: string; description: string; intro: ReactNode;
  /** Said once every plan has completed. */
  done: (files: number) => string;
  testId: string;
  /** Show each plan's exact changes before approval. */
  showDiff?: boolean;
  start: () => Promise<Writeback[]>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [plans, setPlans] = useState<Writeback[]>([]);
  const refresh = async (list: Writeback[]) => setPlans(await Promise.all(list.map((p) => get<Writeback>(`/admin/writebacks/${p.id}`))));
  const plan = useMutation({ mutationFn: start, onSuccess: (list) => setPlans(list) });
  const approve = useMutation({
    mutationFn: async () => { for (const p of plans) await api("POST", `/admin/writebacks/${p.id}/approve`); },
    onSettled: () => refresh(plans),
  });
  const run = useMutation({
    mutationFn: async () => { for (const p of plans) await api("POST", `/admin/writebacks/${p.id}/execute`); },
    onSettled: () => { void refresh(plans); void qc.invalidateQueries({ queryKey: ["title"] }); },
  });
  const count = (stage: string) => plans.filter((p) => p.stage === stage).length;
  // A write that reached its target ends in the "published" stage.
  const all = (...stages: string[]) => plans.length > 0 && plans.every((p) => stages.includes(p.stage));
  const finished = all("published", "recovered");
  const failed = plan.error ?? approve.error ?? run.error;
  const refused = plans.filter((p) => p.stage === "refused" || p.stage === "abandoned");
  return (
    <Drawer open onClose={onClose} title={title} description={description}
      actions={<Button icon={icons.close} onClick={onClose}>{finished ? "Done" : "Cancel"}</Button>}>
      <Stack gap="sm">
        {plans.length === 0 && (
          <>
            <Text size="sm">{intro}</Text>
            <Row><Button variant="primary" icon={icons.search} loading={plan.isPending} onClick={() => plan.mutate()}>Preview the change</Button></Row>
          </>
        )}
        {plans.length > 0 && (
          <Stack gap="xs">
            <Row gap="sm" wrap>
              <Text size="sm">{plans.length === 1 ? "1 file" : `${plans.length} files`}:</Text>
              {["planned", "approved", "published", "recovered", "refused", "abandoned"].filter((s) => count(s) > 0).map((s) => <Badge key={s} data-testid={`${testId}-${s}`}>{count(s)} {s}</Badge>)}
            </Row>
            {plans.length <= 10 && plans.map((p) => (
              <Stack key={p.id} gap="xs">
                <Text size="xs" tone="dim">{p.target} — {p.stage}</Text>
                {showDiff && <CodeBlock label="Exact change (scrollable)">{JSON.stringify(p.diff, null, 2)}</CodeBlock>}
              </Stack>
            ))}
            {all("planned") && <Row><Button variant="primary" icon={icons.check} loading={approve.isPending} onClick={() => approve.mutate()}>Approve exactly {plans.length === 1 ? "this change" : `these ${plans.length} changes`}</Button></Row>}
            {all("approved") && <Row><Button variant="danger" solid icon={icons.pencil} loading={run.isPending} onClick={() => run.mutate()}>Write {plans.length === 1 ? "the file" : `all ${plans.length} files`} now</Button></Row>}
            {finished && <Alert tone="success">{done(plans.length)}</Alert>}
            {refused.length > 0 && <Alert tone="danger">{refused[0]!.detail || "A write was refused and that file was not changed."}</Alert>}
          </Stack>
        )}
        {failed && <Alert tone="danger">{words(failed)}</Alert>}
      </Stack>
    </Drawer>
  );
}
