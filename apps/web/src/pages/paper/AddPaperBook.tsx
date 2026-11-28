import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, get } from "../../api/client";
import type { Library, Page, PaperLookupResults, PaperTitleMatch, PhysicalCopy } from "../../api/types";
import { Alert, Button, Card, Drawer, ErrorBox, icons, NumberField, Row, SelectField, Stack, Text, TextAreaField, TextField } from "../../ui";
import { PROVIDER_NAME } from "../title/ProviderSearch";
import { CopyFields } from "./CopyFields";
import { authorList, copyDetails, emptyBook, emptyCopy, fromCandidate, newTitle, operationIds, type BookForm, type CopyForm } from "./paper";

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Refresh everything a changed copy can show in. `gone` is a title that left the catalogue: it is not asked for again. */
export function useCopiesChanged() {
  const qc = useQueryClient();
  return (gone?: string) => {
    void qc.invalidateQueries({ predicate: (q) => ["title", "titles", "authors", "series", "directory", "shelf", "shelves"].includes(String(q.queryKey[0])) && !(gone && q.queryKey[1] === gone) });
    void qc.invalidateQueries({ queryKey: ["admin", "copy-locations"] });
    if (gone) setTimeout(() => qc.removeQueries({ predicate: (q) => q.queryKey[1] === gone }), 0);
  };
}

function MatchList({ matches, onUse }: { matches: PaperTitleMatch[]; onUse: (m: PaperTitleMatch) => void }) {
  return (
    <Stack gap="sm">
      {matches.map((m) => (
        <Row key={m.titleId} justify="between" wrap>
          <Stack gap="xs">
            <Text strong>{m.title}</Text>
            <Text size="sm" tone="dim">{m.authors.join(", ") || "Unknown author"} · {m.sameIsbn ? "same ISBN" : "same title and first author"}</Text>
          </Stack>
          <Button size="sm" icon={icons.plus} onClick={() => onUse(m)}>Add the copy to this book</Button>
        </Row>
      ))}
    </Stack>
  );
}

/**
 * Add a paper copy (ADR-0116): of a book already in the catalogue, or of a new one looked up by ISBN or typed in.
 * A book that may already be there is never joined or duplicated without the person choosing which.
 */
export function AddPaperBook({ existing, libraryId, onClose }: { existing?: { id: string; title: string }; libraryId?: string; onClose: () => void }) {
  const nav = useNavigate();
  const changed = useCopiesChanged();
  const nextOp = useRef(operationIds());
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const [chosenLibrary, setLibrary] = useState(libraryId ?? "");
  const library = chosenLibrary || (libs.data?.items.length === 1 ? libs.data.items[0]!.id : "");
  const [target, setTarget] = useState(existing ?? null);
  const [book, setBook] = useState<BookForm>(emptyBook);
  const [copy, setCopy] = useState<CopyForm>(emptyCopy);
  const [asked, setAsked] = useState<PaperTitleMatch[] | null>(null);
  const field = <K extends keyof BookForm>(k: K, v: BookForm[K]) => { setBook((b) => ({ ...b, [k]: v })); setAsked(null); };

  const lookup = useMutation({
    mutationFn: () => api<PaperLookupResults>("POST", `/admin/libraries/${library}/physical-lookup`, { isbn: copy.isbn.trim() }),
  });

  const add = useMutation({
    meta: { success: "Paper copy added" },
    mutationFn: async ({ separate, onto }: { separate?: boolean; onto?: string }): Promise<PhysicalCopy | null> => {
      const titleId = onto ?? target?.id;
      const request = {
        libraryId: library, copy: copyDetails(copy),
        ...(titleId ? { titleId } : { newTitle: newTitle(book), ...(separate ? { separateFromMatches: true } : {}) }),
      };
      try {
        return await api<PhysicalCopy>("POST", "/admin/physical-copies", { operationId: nextOp.current(request), ...request });
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "title_match") throw e;
        const found = await api<PaperLookupResults>("POST", `/admin/libraries/${library}/physical-lookup`,
          { title: book.title.trim(), authors: authorList(book.authors), ...(copy.isbn.trim() ? { isbn: copy.isbn.trim() } : {}) });
        setAsked(found.matches);
        return null;
      }
    },
    onSuccess: (c) => {
      if (!c) return;
      changed();
      onClose();
      if (!existing) nav(`/titles/${c.titleId}`);
    },
  });

  const candidates = (lookup.data?.results ?? []).flatMap((r) => r.candidates.map((c) => ({ ...c, provider: r.provider })));
  const failed = (lookup.data?.results ?? []).filter((r) => r.status === "unavailable" || r.status === "unconfigured");
  const ready = !!library && (!!target || !!book.title.trim());
  const attach = (m: PaperTitleMatch) => { setTarget({ id: m.titleId, title: m.title }); setAsked(null); add.reset(); };

  return (
    <Drawer open onClose={onClose} size="lg" title={existing ? "Add a paper copy" : "Add paper book"}
      description={existing ? `Another copy of ${existing.title}.` : "Record a book you own on paper. Look it up by ISBN, or type its details."}
      actions={<>
        <Button onClick={onClose} icon={icons.close}>Cancel</Button>
        <Button variant="primary" icon={icons.save} disabled={!ready || !!asked} loading={add.isPending} onClick={() => add.mutate({})}>
          {target ? "Add copy" : "Add book"}
        </Button>
      </>}>
      <Stack>
        <SelectField label="Library" description="Everyone with access to it sees the copy." placeholder="Choose a library" emptyText="No libraries yet" required
          value={library || null} items={(libs.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))}
          onValue={(v) => { setLibrary(v ?? ""); lookup.reset(); setAsked(null); }} />

        {!target && (
          <Row gap="sm" wrap align="end">
            <TextField label="ISBN" description="From the back cover or the title page." value={copy.isbn} maxLength={32}
              onValue={(v) => { setCopy((c) => ({ ...c, isbn: v })); lookup.reset(); setAsked(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && library && copy.isbn.trim()) lookup.mutate(); }} />
            <Button icon={icons.search} disabled={!library || !copy.isbn.trim()} loading={lookup.isPending} onClick={() => lookup.mutate()}>Look up</Button>
          </Row>
        )}
        <ErrorBox error={lookup.error} />

        {!target && lookup.data && (
          <Stack gap="sm" data-testid="paper-lookup">
            {lookup.data.matches.length > 0 && (
              <Alert tone="info" title="Already in your catalogue">
                <MatchList matches={lookup.data.matches} onUse={attach} />
              </Alert>
            )}
            {candidates.map((c) => (
              <Card key={`${c.provider}-${c.id}`}>
                <Row justify="between" wrap>
                  <Stack gap="xs">
                    <Text strong>{text(c.fields.title) || "(untitled)"}</Text>
                    <Text size="sm" tone="dim">{[Array.isArray(c.fields.authors) ? (c.fields.authors as string[]).join(", ") : "", text(c.fields.publisher), text(c.fields.published),
                      PROVIDER_NAME[c.provider] ?? c.provider].filter(Boolean).join(" · ")}</Text>
                  </Stack>
                  <Button size="sm" icon={icons.check} onClick={() => {
                    const filled = fromCandidate(c.fields);
                    setBook({ ...emptyBook, ...filled.book });
                    setCopy((x) => ({ ...x, ...filled.copy }));
                    setAsked(null);
                  }}>Use these details</Button>
                </Row>
              </Card>
            ))}
            {!lookup.data.enabled && <Text size="sm" tone="dim">Online lookups are off for this library. Type the details below, or turn on a provider in the library settings.</Text>}
            {lookup.data.enabled && candidates.length === 0 && <Text size="sm" tone="dim">Nothing was found for this ISBN. Type the details below.</Text>}
            {failed.length > 0 && <Text size="sm" tone="warning">Could not ask {failed.map((r) => PROVIDER_NAME[r.provider] ?? r.provider).join(", ")}.</Text>}
          </Stack>
        )}

        {target ? (
          <Row justify="between" wrap>
            <Text>Adding a copy of <strong>{target.title}</strong>.</Text>
            {!existing && <Button size="sm" icon={icons.reset} onClick={() => setTarget(null)}>Add a different book</Button>}
          </Row>
        ) : (
          <Stack>
            <TextField label="Title" required value={book.title} onValue={(v) => field("title", v)} maxLength={2048} />
            <TextField label="Authors" description="Separate several with commas." value={book.authors} onValue={(v) => field("authors", v)} />
            <TextField label="Series" value={book.series} onValue={(v) => field("series", v)} maxLength={512} />
            <NumberField label="Number in the series" value={book.seriesIndex} onValue={(v) => field("seriesIndex", v)} min={0} />
            <TextField label="Publisher" value={book.publisher} onValue={(v) => field("publisher", v)} maxLength={512} />
            <TextField label="Published" description="A year, year-month or full date." value={book.published} onValue={(v) => field("published", v)} maxLength={10} />
            <TextAreaField label="Description" value={book.description} onValue={(v) => field("description", v)} rows={4} maxLength={8000} />
          </Stack>
        )}

        {!target && <Text size="sm" tone="dim">The ISBN above is saved with this copy.</Text>}
        <CopyFields value={copy} onValue={(v) => { setCopy(v); setAsked(null); }} libraryId={library} />

        {asked && (
          <Alert tone="warning" title="Your catalogue may already have this book" data-testid="paper-matches">
            <Stack gap="sm">
              <MatchList matches={asked} onUse={(m) => { attach(m); add.mutate({ onto: m.titleId }); }} />
              <div><Button size="sm" icon={icons.plus} loading={add.isPending} onClick={() => add.mutate({ separate: true })}>Add as a separate book</Button></div>
            </Stack>
          </Alert>
        )}
        <ErrorBox error={add.error} />
      </Stack>
    </Drawer>
  );
}
