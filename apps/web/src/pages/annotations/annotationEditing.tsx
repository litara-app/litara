import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Annotation } from "../../api/types";
import { icons, Badge, Button, Card, ConfirmDialog, Drawer, ErrorBox, Quote, Row, Stack, Text, TextAreaField, TextLink, when } from "../../ui";

export const KIND_LABEL = { highlight: "Highlight", note: "Note", bookmark: "Bookmark" } as const;
const KIND_TONE = { highlight: "warning", note: "info", bookmark: "success" } as const;

/**
 * Editing a note and deleting an entry, with the revisioned writes of ADR-0066: a stale edit or delete is refused and
 * shown, never applied over newer work. Every annotation list (a title's Highlights tab, the hub) refreshes after.
 */
export function useAnnotationEditing() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [text, setText] = useState("");
  const [removing, setRemoving] = useState<Annotation | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["annotations"] });

  const saveNote = useMutation({
    mutationFn: (a: Annotation) =>
      api("PUT", `/editions/${a.editionId}/annotations/${a.id}`, {
        baseRevision: a.revision, capturedAt: new Date().toISOString(), operationId: crypto.randomUUID(), data: { ...a.data!, text },
      }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (a: Annotation) => api("DELETE", `/editions/${a.editionId}/annotations/${a.id}`, { baseRevision: a.revision, capturedAt: new Date().toISOString(), operationId: crypto.randomUUID() }),
    onSuccess: () => setRemoving(null),
    onSettled: refresh,
  });

  const dialogs = (
    <>
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
    </>
  );
  return {
    edit: (a: Annotation) => { setText(a.data?.text ?? ""); setEditing(a); saveNote.reset(); },
    remove: (a: Annotation) => { setRemoving(a); remove.reset(); },
    dialogs,
  };
}

/** One live annotation: kind, where it is from, its quote and note, and what can be done with it. */
export function AnnotationCard({ a, source, book, readerTo, onEdit, onRemove }: {
  a: Annotation; source?: string; book?: { title: string; to: string; authors?: string[] }; readerTo?: string;
  onEdit: () => void; onRemove: () => void;
}) {
  const d = a.data!;
  let byline: ReactNode = null;
  if (book) byline = <Text size="sm"><TextLink to={book.to}>{book.title}</TextLink>{book.authors?.length ? <Text as="span" size="sm" tone="dim"> · {book.authors.join(", ")}</Text> : null}</Text>;
  return (
    <Card data-testid="annotation-card">
      <Stack gap="sm">
        <Row justify="between">
          <Row gap="xs"><Badge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</Badge>{source && <Text as="span" size="xs" tone="dim">{source}</Text>}</Row>
          <Text as="span" size="xs" tone="dim">{when(a.updatedAt)}</Text>
        </Row>
        {byline}
        {d.quote && <Quote>{d.quote}</Quote>}
        {d.text && <Text>{d.text}</Text>}
        <Row gap="xs">
          {readerTo && <Button size="sm" to={readerTo} icon={icons.bookOpen}>Open in reader</Button>}
          {d.kind !== "bookmark" && <Button size="sm" onClick={onEdit} icon={icons.pencil}>{d.text ? "Edit note" : "Add note"}</Button>}
          <Button size="sm" onClick={onRemove} icon={icons.trash}>Delete</Button>
        </Row>
      </Stack>
    </Card>
  );
}
