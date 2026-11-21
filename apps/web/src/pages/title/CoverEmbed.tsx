import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, get } from "../../api/client";
import type { Edition, RecordingLink } from "../../api/types";
import { Alert, Badge, Button, Modal, Row, Stack, Text, icons } from "../../ui";

interface Writeback { id: string; kind: string; format?: string; target: string; stage: string; detail?: string; backedUp: boolean; diff: unknown }

const words = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
type Medium = "ebook" | "audio";

/**
 * Write the stored cover into the book file (ADR-0086, phase 2). It uses the same reviewed plan as any in-file write: the
 * format's writer must be turned on, nothing is written until the exact change is approved, and each file is staged,
 * checked and replaced atomically. Litara's own copy of the cover is never affected by what happens to a file.
 */
export function CoverEmbed({ medium, editions, recordings }: { medium: Medium; editions: Edition[]; recordings: RecordingLink[] }) {
  const [open, setOpen] = useState<{ key: string; label: string; start: () => Promise<Writeback[]> } | null>(null);
  const targets = medium === "ebook"
    ? editions.map((e) => ({
      key: e.id, label: `${e.file.format.toUpperCase()} file`,
      start: async () => [await api<Writeback>("POST", `/admin/files/${e.file.id}/cover-writebacks`, { medium: "ebook" })],
    }))
    : recordings.map((r) => ({
      key: r.id, label: r.label || "audiobook files",
      start: async () => (await api<{ items: Writeback[] }>("POST", `/admin/recordings/${r.id}/cover-writebacks`)).items,
    }));
  if (targets.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text size="sm" tone="dim">The cover Litara shows can also be written into the {medium === "ebook" ? "book file" : "audiobook files"} itself, so other readers and devices show it. This changes the files, so you review and approve it first.</Text>
      <Row gap="sm" wrap>
        {targets.map((t) => <Button key={t.key} icon={icons.pencil} onClick={() => setOpen(t)}>Write into {t.label}…</Button>)}
      </Row>
      {open && <EmbedDialog key={open.key} label={open.label} start={open.start} onClose={() => setOpen(null)} />}
    </Stack>
  );
}

function EmbedDialog({ label, start, onClose }: { label: string; start: () => Promise<Writeback[]>; onClose: () => void }) {
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
  const all = (stage: string) => plans.length > 0 && count(stage) === plans.length;
  const failed = plan.error ?? approve.error ?? run.error;
  const refused = plans.filter((p) => p.stage === "refused" || p.stage === "abandoned");
  return (
    <Modal open onClose={onClose} title={`Write the cover into ${label}`}
      description="This replaces or adds the cover picture inside the file. Everything else in the file stays as it is."
      actions={<Button icon={icons.close} onClick={onClose}>{all("completed") ? "Done" : "Cancel"}</Button>}>
      <Stack gap="sm">
        {plans.length === 0 && (
          <>
            <Text size="sm">The file is changed on disk and gets a new version. A backup copy is kept only if backups are turned on for this library.
              Each write is checked before it replaces the file, and is refused if the file or the cover changed after you reviewed it.</Text>
            <Row><Button variant="primary" icon={icons.search} loading={plan.isPending} onClick={() => plan.mutate()}>Preview the change</Button></Row>
          </>
        )}
        {plans.length > 0 && (
          <Stack gap="xs">
            <Row gap="sm" wrap>
              <Text size="sm">{plans.length === 1 ? "1 file" : `${plans.length} files`}:</Text>
              {["planned", "approved", "completed", "refused"].filter((s) => count(s) > 0).map((s) => <Badge key={s} data-testid={`cover-embed-${s}`}>{count(s)} {s}</Badge>)}
            </Row>
            {plans.length <= 10 && plans.map((p) => <Text key={p.id} size="xs" tone="dim">{p.target} — {p.stage}</Text>)}
            {all("planned") && <Row><Button variant="primary" icon={icons.check} loading={approve.isPending} onClick={() => approve.mutate()}>Approve exactly {plans.length === 1 ? "this change" : `these ${plans.length} changes`}</Button></Row>}
            {all("approved") && <Row><Button variant="danger" solid icon={icons.pencil} loading={run.isPending} onClick={() => run.mutate()}>Write into {plans.length === 1 ? "the file" : `all ${plans.length} files`} now</Button></Row>}
            {all("completed") && <Alert tone="success">The cover is now inside {plans.length === 1 ? "the file" : "the files"}. Run a scan if you want the catalog to pick up the new file versions.</Alert>}
            {refused.length > 0 && <Alert tone="danger">{refused[0]!.detail || "A write was refused and that file was not changed."}</Alert>}
          </Stack>
        )}
        {failed && <Alert tone="danger">{words(failed)}</Alert>}
      </Stack>
    </Modal>
  );
}
