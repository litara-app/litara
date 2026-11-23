import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, get } from "../../api/client";
import type { Annotation, Edition, Page } from "../../api/types";
import { icons, Badge, Busy, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Drawer, Quote, Row, SegmentedField, Stack, Text, TextAreaField, when } from "../../ui";

type Kind = "all" | "highlight" | "note" | "bookmark";
const KIND_LABEL = { highlight: "Highlight", note: "Note", bookmark: "Bookmark" } as const;
const KIND_TONE = { highlight: "warning", note: "info", bookmark: "success" } as const;

/** Highlights, notes and bookmarks from every edition of this title. */
export function HighlightsTab({ editions }: { editions: Edition[] }) {
  const qc = useQueryClient();
  const results = useQueries({
    queries: editions.map((e) => ({ queryKey: ["annotations", e.id], queryFn: () => get<Page<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) })),
  });
  const [kind, setKind] = useState<Kind>("all");
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [text, setText] = useState("");
  const [removing, setRemoving] = useState<Annotation | null>(null);

  const all = useMemo(() => results.flatMap((r) => r.data?.items ?? []).filter((a) => !a.deleted && a.data), [results]);
  const shown = all.filter((a) => kind === "all" || a.data!.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = (k: Kind) => all.filter((a) => k === "all" || a.data!.kind === k).length;
  const editionOf = (a: Annotation) => editions.find((e) => e.id === a.editionId);
  const refresh = (a: Annotation) => qc.invalidateQueries({ queryKey: ["annotations", a.editionId] });

  const saveNote = useMutation({
    mutationFn: (a: Annotation) =>
      api("PUT", `/editions/${a.editionId}/annotations/${a.id}`, {
        baseRevision: a.revision, capturedAt: new Date().toISOString(), operationId: crypto.randomUUID(), data: { ...a.data!, text },
      }),
    onSuccess: () => setEditing(null),
    onSettled: (_d, _e, a) => refresh(a),
  });
  const remove = useMutation({
    mutationFn: (a: Annotation) => api("DELETE", `/editions/${a.editionId}/annotations/${a.id}`, { baseRevision: a.revision, capturedAt: new Date().toISOString(), operationId: crypto.randomUUID() }),
    onSuccess: () => setRemoving(null),
    onSettled: (_d, _e, a) => refresh(a),
  });

  if (editions.length === 0) return <EmptyState level={3} title="No ebook to highlight">Highlights and notes come from reading an ebook.</EmptyState>;
  if (results.some((r) => r.isPending)) return <Busy />;

  return (
    <Stack>
      <SegmentedField label="Show" value={kind} onValue={(v) => setKind(v as Kind)}
        items={(["all", "highlight", "note", "bookmark"] as const).map((k) => ({ value: k, label: `${k === "all" ? "All" : KIND_LABEL[k] + "s"} (${counts(k)})` }))} />
      <ErrorBox error={results.find((r) => r.error)?.error} />
      {shown.length === 0 ? (
        <EmptyState level={3} title={all.length === 0 ? "No highlights yet" : "Nothing of that kind"}>
          {all.length === 0 ? "Select text while reading to highlight it or add a note." : "Try another filter."}
        </EmptyState>
      ) : shown.map((a) => {
        const d = a.data!;
        const e = editionOf(a);
        return (
          <Card key={a.id} data-testid="annotation-card">
            <Stack gap="sm">
              <Row justify="between">
                <Row gap="xs"><Badge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</Badge>{e && <Text as="span" size="xs" tone="dim">{e.label || e.file.format.toUpperCase()}</Text>}</Row>
                <Text as="span" size="xs" tone="dim">{when(a.updatedAt)}</Text>
              </Row>
              {d.quote && <Quote>{d.quote}</Quote>}
              {d.text && <Text>{d.text}</Text>}
              <Row gap="xs">
                {e && <Button size="sm" to={`/read/${e.id}`} icon={icons.bookOpen}>Open in reader</Button>}
                {d.kind !== "bookmark" && <Button size="sm" onClick={() => { setText(d.text); setEditing(a); saveNote.reset(); }} icon={icons.pencil}>{d.text ? "Edit note" : "Add note"}</Button>}
                <Button size="sm" onClick={() => { setRemoving(a); remove.reset(); }} icon={icons.trash}>Delete</Button>
              </Row>
            </Stack>
          </Card>
        );
      })}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title="Note"
        actions={<><Button onClick={() => setEditing(null)} icon={icons.close}>Cancel</Button><Button variant="primary" loading={saveNote.isPending} onClick={() => editing && saveNote.mutate(editing)} icon={icons.save}>Save</Button></>}>
        {editing?.data?.quote && <Quote>{editing.data.quote}</Quote>}
        <TextAreaField label="Your note" value={text} onValue={setText} rows={4} />
        <ErrorBox error={saveNote.error} />
      </Drawer>
      <ConfirmDialog open={!!removing} title="Delete this entry?" confirmLabel="Delete" danger loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)} onCancel={() => setRemoving(null)}>
        It is removed from every device you read on. This cannot be undone.
        <ErrorBox error={remove.error} />
      </ConfirmDialog>
    </Stack>
  );
}
