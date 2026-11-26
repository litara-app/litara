import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, get, op } from "../api/client";
import type { AudioBookmark, AudioBookmarkConflict, AudioBookmarkData, Page } from "../api/types";
import { Alert, Badge, Button, ErrorBox, Row, Stack, Text, TextField, icons } from "../ui";
import { fmt } from "./timeline";
import type { PlayerController } from "./usePlayerController";

/**
 * This account's bookmarks on the playing audiobook (ADR-0110). A bookmark is a place in one file version. One whose
 * file or layout has changed is kept and shown, but cannot be opened. A change the server could not apply waits here for
 * the listener to choose.
 */
export function Bookmarks({ c }: { c: PlayerController }) {
  const r = c.recording;
  const qc = useQueryClient();
  const base = `/recordings/${r.id}/bookmarks`;
  const key = ["bookmarks", r.id];
  const list = useQuery({ queryKey: key, queryFn: () => get<Page<AudioBookmark>>(`${base}?size=200`) });
  const conflicts = useQuery({ queryKey: [...key, "conflicts"], queryFn: () => get<{ items: AudioBookmarkConflict[] }>(`/recordings/${r.id}/bookmark-conflicts`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [editing, setEditing] = useState<{ id: string; note: string } | null>(null);

  const whole = (d: AudioBookmarkData) => {
    const i = r.files.findIndex((f) => f.id === d.fileId);
    return i < 0 ? null : (c.offsets[i] ?? 0) + d.offsetMs;
  };
  const save = useMutation({
    mutationFn: ({ id, revision, data }: { id: string; revision: string; data: AudioBookmarkData }) =>
      api<AudioBookmark>("PUT", `${base}/${id}`, { ...op(revision), data }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (b: AudioBookmark) => api("DELETE", `${base}/${b.id}`, op(b.revision)), onSettled: refresh });
  const resolve = useMutation({
    mutationFn: async ({ conflict, choice }: { conflict: AudioBookmarkConflict; choice: "keep_current" | "use_candidate" }) => {
      // The choice is made against the bookmark as it is now. A bookmark that was never stored has revision 0.
      const now = await get<AudioBookmark>(`${base}/${conflict.bookmarkId}`).catch((e: unknown) => {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      });
      await api("POST", `/recordings/${r.id}/bookmark-conflicts/${conflict.id}/resolve`, { operationId: crypto.randomUUID(), choice, baseRevision: now?.revision ?? "0" });
    },
    onSettled: refresh,
  });
  const add = () => {
    const at = c.player.anchor();
    const length = r.files.find((f) => f.id === at.fileId)?.durationMs;
    save.mutate({ id: crypto.randomUUID(), revision: "0", data: { ...at, offsetMs: length ? Math.min(at.offsetMs, length) : at.offsetMs, layoutRevision: r.layoutRevision, note: "" } });
  };

  const items = [...(list.data?.items ?? [])].sort((a, b) => (whole(a.data!) ?? Infinity) - (whole(b.data!) ?? Infinity));
  return (
    <section className="lt-spread-chapters lt-corners-sm" aria-label="Bookmarks" data-testid="bookmarks">
      <Row justify="between">
        <h3 className="lt-spread-chapters-title">Bookmarks</h3>
        <Button size="sm" icon={icons.bookmark} disabled={!c.ready} loading={save.isPending && save.variables?.revision === "0"} onClick={add}>Add bookmark</Button>
      </Row>
      <Stack gap="xs">
        <ErrorBox error={list.error ?? conflicts.error ?? save.error ?? remove.error ?? resolve.error} />
        {(conflicts.data?.items ?? []).map((x) => (
          <Alert key={x.id} tone="warning" title="A bookmark change was not applied" data-testid="bookmark-conflict">
            <Stack gap="xs">
              <Text size="sm">{x.candidate ? `Your change: ${fmt(whole(x.candidate) ?? x.candidate.offsetMs)} ${x.candidate.note}`.trim() : "Your change: delete this bookmark."}</Text>
              <Row wrap>
                <Button size="sm" variant="primary" icon={icons.check} onClick={() => resolve.mutate({ conflict: x, choice: "keep_current" })}>Keep what is saved</Button>
                <Button size="sm" icon={icons.check} onClick={() => resolve.mutate({ conflict: x, choice: "use_candidate" })}>Use my change</Button>
              </Row>
            </Stack>
          </Alert>
        ))}
        {list.data && items.length === 0 && <Text size="sm" tone="dim">No bookmarks yet.</Text>}
        {items.map((b) => {
          const d = b.data!;
          const at = whole(d);
          return (
            <Stack key={b.id} gap="xs" data-testid="bookmark">
              <Row justify="between" wrap>
                <Row gap="xs">
                  <Button size="sm" variant="subtle" icon={icons.chevRight} disabled={!c.ready || !b.available} onClick={() => c.player.seekWhole(at!)}>
                    <span className="lt-mono">{at === null ? "Unknown time" : fmt(at)}</span>
                  </Button>
                  {d.note && <Text as="span" size="sm">{d.note}</Text>}
                  {!b.available && <Badge tone="warning">the audio changed</Badge>}
                </Row>
                <Row gap="xs">
                  <Button size="sm" icon={icons.pencil} onClick={() => setEditing({ id: b.id, note: d.note })}>Note</Button>
                  <Button size="sm" variant="danger" icon={icons.trash} loading={remove.isPending && remove.variables?.id === b.id} onClick={() => remove.mutate(b)}>Delete</Button>
                </Row>
              </Row>
              {editing?.id === b.id && (
                <Row align="end" wrap>
                  <TextField label="Bookmark note" value={editing.note} onValue={(note) => setEditing({ id: b.id, note })} />
                  <Button size="sm" variant="primary" icon={icons.save} loading={save.isPending} onClick={() => save.mutate({ id: b.id, revision: b.revision, data: { ...d, note: editing.note } })}>Save note</Button>
                  <Button size="sm" icon={icons.close} onClick={() => setEditing(null)}>Cancel</Button>
                </Row>
              )}
            </Stack>
          );
        })}
      </Stack>
    </section>
  );
}
