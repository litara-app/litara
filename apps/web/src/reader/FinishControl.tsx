import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, get } from "../api/client";
import type { Edition } from "../api/types";
import { icons, Badge, Button, ConfirmDialog, ErrorBox, Row, Stack, Text } from "../ui";

interface CompletionState { revision: string; finished: boolean; changedAt: string | null }

/**
 * Explicit finish/unfinish from inside the reader (ADR-0065): never automatic at the last page, applies to this
 * edition only, and leaves the reading place untouched. The current revision is read just before the write so a
 * stale view cannot overwrite a newer state; a conflict shows the server's answer.
 */
export function FinishControl({ edition }: { edition: Edition }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const key = ["completion", edition.id];
  const state = useQuery({ queryKey: key, queryFn: () => get<CompletionState>(`/editions/${edition.id}/completion`) });
  const write = useMutation({
    mutationFn: async (event: "manual_finish" | "manual_unfinish") => {
      const cur = await get<CompletionState>(`/editions/${edition.id}/completion`);
      return api("PUT", `/editions/${edition.id}/completion`, {
        operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString(),
        fileId: edition.file.id, contentVersion: edition.file.contentVersion, event,
      });
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["edition", edition.id] }); },
    onSuccess: () => setConfirm(false),
  });
  const finished = state.data?.finished ?? edition.completion.finished;
  return (
    <Stack gap="sm" data-testid="finish-control">
      <Row justify="between">
        <Text as="span" size="sm">{finished ? "You marked this book finished." : "Not marked finished."}</Text>
        {finished && <Badge tone="success" data-testid="finished-badge">Finished</Badge>}
      </Row>
      <Row>
        <Button size="sm" variant={finished ? "default" : "primary"} onClick={() => setConfirm(true)} icon={icons.check}>
          {finished ? "Mark unfinished…" : "Mark finished…"}
        </Button>
      </Row>
      <ErrorBox error={write.error} />
      <ConfirmDialog open={confirm} title={finished ? "Mark this book unfinished?" : "Mark this book finished?"} confirmLabel={finished ? "Mark unfinished" : "Mark finished"}
        loading={write.isPending} onCancel={() => setConfirm(false)} onConfirm={() => write.mutate(finished ? "manual_unfinish" : "manual_finish")}>
        {finished
          ? "This records the book as unfinished again. Your reading place is not changed."
          : "This records the book as finished. It is never done automatically when you reach the last page, and your reading place is not changed."}
      </ConfirmDialog>
    </Stack>
  );
}
