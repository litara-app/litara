import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, get, op, qs } from "../../api/client";
import type { Library, Page, PaperReading, PhysicalCopy, Title, TitleRow } from "../../api/types";
import { useAuth } from "../../auth/session";
import { Button, ConfirmDialog, Drawer, ErrorBox, icons, Ledger, NumberField, Panel, Row, SearchField, SelectField, Stack, StatusPill, Text } from "../../ui";
import { useDebounced } from "../../ui/useDebounced";
import { AddPaperBook, useCopiesChanged } from "./AddPaperBook";
import { CopyFields } from "./CopyFields";
import { bindingLabel, copyDetails, copyForm, operationIds, type CopyForm } from "./paper";

export const copiesKey = (titleId: string) => ["title", titleId, "physical-copies"];
export const useTitleCopies = (title: Title) => useQuery({
  queryKey: copiesKey(title.id), enabled: title.physicalCopyCount > 0,
  queryFn: () => get<Page<PhysicalCopy>>(`/titles/${title.id}/physical-copies?size=200`),
});

/** A short name for one copy among several: where it is, else what it is. */
export const copyName = (c: PhysicalCopy) => (c.location ? `${bindingLabel(c.binding)}, ${c.location}` : bindingLabel(c.binding));

/** Your own reading of one copy. No page number is ever needed. */
function Reading({ copy }: { copy: PhysicalCopy }) {
  const qc = useQueryClient();
  const key = ["paper-reading", copy.id];
  const reading = useQuery({ queryKey: key, queryFn: () => get<PaperReading>(`/physical-copies/${copy.id}/reading`) });
  const [page, setPage] = useState<number | null | undefined>(undefined);
  const save = useMutation({
    mutationFn: (v: { status: PaperReading["status"]; page: number | null }) =>
      api<PaperReading>("PUT", `/physical-copies/${copy.id}/reading`, { ...op(reading.data!.revision), status: v.status, ...(v.page !== null ? { page: v.page } : {}) }),
    meta: { success: "Your reading is saved" },
    onSuccess: (r) => { qc.setQueryData(key, r); setPage(undefined); },
    // A stale revision refetches and shows what the server has, which may come from another device.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "title" || q.queryKey[0] === "titles" || q.queryKey[0] === "stats" });
    },
  });
  if (!reading.data) return <ErrorBox error={reading.error} />;
  const r = reading.data;
  const shownPage = page === undefined ? r.page : page;
  const pages = copy.pageCount ?? undefined;
  const stale = save.error instanceof ApiError && save.error.code === "stale_revision";
  const set = (status: PaperReading["status"], p: number | null) => save.mutate({ status, page: status === "not_started" ? null : p });
  return (
    <Stack gap="sm" data-testid="paper-reading">
      <Row gap="xs" wrap>
        {r.status === "finished" ? <StatusPill state="finished" /> : <Text as="span" size="sm" tone="dim">{r.status === "reading" ? "You are reading this copy." : "Not started."}</Text>}
        {r.page !== null && <Text as="span" size="sm" tone="dim">Page {r.page}{pages ? ` of ${pages}` : ""}</Text>}
      </Row>
      <Row gap="xs" wrap>
        {r.status === "not_started" && <Button size="sm" icon={icons.bookOpen} disabled={save.isPending} onClick={() => set("reading", null)}>Start reading</Button>}
        {r.status === "finished" && <Button size="sm" icon={icons.bookOpen} disabled={save.isPending} onClick={() => set("reading", null)}>Read again</Button>}
        {r.status !== "finished" && <Button size="sm" icon={icons.check} disabled={save.isPending} onClick={() => set("finished", r.page)}>Mark finished</Button>}
        {r.status !== "not_started" && <Button size="sm" variant="subtle" icon={icons.reset} disabled={save.isPending} onClick={() => set("not_started", null)}>{r.status === "finished" ? "Mark not finished" : "Stop reading"}</Button>}
      </Row>
      {r.status === "reading" && (
        <Row gap="xs" wrap align="end">
          <NumberField label="Page (optional)" value={shownPage} onValue={setPage} min={1} max={pages ?? 100000} step={1} />
          <Button size="sm" icon={icons.save} disabled={save.isPending || page === undefined || page === r.page || (page !== null && !!pages && page > pages)}
            onClick={() => set("reading", page ?? null)}>Save page</Button>
        </Row>
      )}
      {stale ? <Text size="sm" tone="warning" role="alert">Your reading changed somewhere else, so this was not saved. Check it and try again.</Text> : <ErrorBox error={save.error} />}
    </Stack>
  );
}

/** Change a copy, or move it to the book it really is. */
function EditCopy({ copy, title, onClose }: { copy: PhysicalCopy; title: Title; onClose: () => void }) {
  const changed = useCopiesChanged();
  const nav = useNavigate();
  const nextOp = useRef(operationIds());
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const [library, setLibrary] = useState(copy.libraryId);
  const [form, setForm] = useState<CopyForm>(() => copyForm(copy));
  const [moveTo, setMoveTo] = useState<{ id: string; title: string } | null>(null);
  const [find, setFind] = useState("");
  const q = useDebounced(find.trim(), 250);
  const found = useQuery({ queryKey: ["titles", "move-copy", q], enabled: q.length > 1, queryFn: () => get<Page<TitleRow>>(`/titles${qs({ q, size: 6 })}`) });
  const save = useMutation({
    meta: { success: "Paper copy saved" },
    mutationFn: () => {
      const request = { baseRevision: copy.revision, titleId: moveTo?.id ?? copy.titleId, libraryId: library, copy: copyDetails(form) };
      return api<PhysicalCopy>("PUT", `/admin/physical-copies/${copy.id}`, { operationId: nextOp.current(request), ...request });
    },
    onSuccess: (c) => {
      // Moving the only copy of a book with no files takes that book out of the catalogue: go to where the copy went.
      const left = c.titleId !== copy.titleId && title.physicalCopyCount === 1 && title.editionCount + title.recordingCount === 0;
      onClose();
      if (left) nav(`/titles/${c.titleId}`);
      changed(left ? copy.titleId : undefined);
    },
    onError: (e) => { if (e instanceof ApiError && e.status === 409) changed(); },
  });
  return (
    <Drawer open onClose={onClose} title="Edit paper copy" description={`A copy of ${title.title}.`}
      actions={<>
        <Button onClick={onClose} icon={icons.close}>Cancel</Button>
        <Button variant="primary" icon={icons.save} loading={save.isPending} disabled={!library} onClick={() => save.mutate()}>Save</Button>
      </>}>
      <Stack>
        <SelectField label="Library" value={library} items={(libs.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))} onValue={(v) => setLibrary(v ?? copy.libraryId)} />
        <CopyFields value={form} onValue={setForm} libraryId={library} />
        {moveTo ? (
          <Row justify="between" wrap>
            <Text>Saving moves this copy, and its reading history, to <strong>{moveTo.title}</strong>.</Text>
            <Button size="sm" icon={icons.reset} onClick={() => setMoveTo(null)}>Keep it here</Button>
          </Row>
        ) : (
          <Stack gap="sm">
            <Text strong>Is this copy filed under the wrong book?</Text>
            <SearchField label="Find the right book" placeholder="Title, author or series" value={find} onValue={setFind} />
            {(found.data?.items ?? []).filter((t) => t.id !== copy.titleId).map((t) => (
              <Row key={t.id} justify="between">
                <Text size="sm">{t.title}{t.authors.length ? ` · ${t.authors.join(", ")}` : ""}</Text>
                <Button size="sm" icon={icons.arrowLeft} onClick={() => setMoveTo({ id: t.id, title: t.title })}>Move here</Button>
              </Row>
            ))}
          </Stack>
        )}
        {save.error instanceof ApiError && save.error.code === "stale_revision"
          ? <Text size="sm" tone="warning" role="alert">This copy changed somewhere else. Close this and open it again.</Text>
          : <ErrorBox error={save.error} />}
      </Stack>
    </Drawer>
  );
}

/** The paper copies of a title: where they are, your reading of each, and for administrators, managing them (ADR-0116). */
export function PaperCopies({ title }: { title: Title }) {
  const { user } = useAuth();
  const changed = useCopiesChanged();
  const nav = useNavigate();
  const lastCopy = title.physicalCopyCount === 1 && title.editionCount + title.recordingCount === 0;
  const copies = useTitleCopies(title);
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PhysicalCopy | null>(null);
  const [removing, setRemoving] = useState<PhysicalCopy | null>(null);
  const nextOp = useRef(operationIds());
  const remove = useMutation({
    meta: { success: "Paper copy removed" },
    mutationFn: (c: PhysicalCopy) => {
      const request = { id: c.id, baseRevision: c.revision };
      return api<PhysicalCopy>("POST", `/admin/physical-copies/${c.id}/remove`, { operationId: nextOp.current(request), baseRevision: c.revision });
    },
    // With its only copy gone, a book with no files is no longer in the catalogue to show.
    onSuccess: () => { if (lastCopy) nav("/"); },
    onSettled: (c) => { setRemoving(null); changed(c && lastCopy ? title.id : undefined); },
  });
  const items = title.physicalCopyCount > 0 ? (copies.data?.items ?? []) : [];
  if (title.physicalCopyCount === 0 && !user?.isAdmin) return null;
  return (
    <Panel title="On paper" aside={title.physicalCopyCount > 0 ? `${title.physicalCopyCount} ${title.physicalCopyCount === 1 ? "copy" : "copies"}` : undefined} data-testid="paper-copies">
      <Stack>
        <ErrorBox error={copies.error} />
        {title.physicalCopyCount === 0 && <Text size="sm" tone="dim">No paper copy is recorded.</Text>}
        {items.map((c) => (
          <Stack key={c.id} gap="sm" data-testid="paper-copy">
            <Text strong>{copyName(c)}</Text>
            <Ledger items={[
              ["Library", libs.data?.items.find((l) => l.id === c.libraryId)?.name ?? "…"],
              ["Location", c.location ?? "Not recorded"],
              ...(c.pageCount ? [["Pages", c.pageCount] as [string, number]] : []),
              ...(c.isbn ? [["ISBN", c.isbn] as [string, string]] : []),
              ...(c.language ? [["Language", c.language] as [string, string]] : []),
              ...(c.acquiredOn ? [["Acquired", new Date(`${c.acquiredOn}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })] as [string, string]] : []),
            ]} />
            {c.note && <Text size="sm">{c.note}</Text>}
            <Reading copy={c} />
            {user?.isAdmin && (
              <Row gap="xs" wrap>
                <Button size="sm" icon={icons.pencil} onClick={() => setEditing(c)}>Edit copy</Button>
                <Button size="sm" variant="subtle" icon={icons.trash} onClick={() => setRemoving(c)}>Remove copy</Button>
              </Row>
            )}
          </Stack>
        ))}
        <ErrorBox error={remove.error} />
        {user?.isAdmin && <div><Button size="sm" icon={icons.plus} onClick={() => setAdding(true)}>Add paper copy</Button></div>}
      </Stack>
      {adding && <AddPaperBook existing={{ id: title.id, title: title.title }} onClose={() => setAdding(false)} />}
      {editing && <EditCopy copy={editing} title={title} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} title="Remove this paper copy?" confirmLabel="Remove copy" danger loading={remove.isPending}
        onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)}>
        {removing ? `${copyName(removing)} will no longer be listed. Everyone keeps their reading history.${lastCopy ? " It is the only copy and the book has no files, so the book leaves the catalogue." : ""} This cannot be undone here.` : ""}
      </ConfirmDialog>
    </Panel>
  );
}
