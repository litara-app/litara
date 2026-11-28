import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, API, ApiError, get, qs, uploadFile } from "../../api/client";
import type { Library, Page as Paged, PaperImport, PaperImportRow, PaperImportRows, PaperImports } from "../../api/types";
import { useAuth } from "../../auth/session";
import {
  Alert, Badge, Busy, Button, Card, CheckboxField, CompactSelect, ConfirmDialog, DownloadLink, EmptyState, ErrorBox, FileDrop, Heading, icons, Page,
  PageHeader, Pager, ProgressBar, Row, SelectField, Stack, Table, TBody, TD, Text, TextLink, TH, THead, ToggleChip, TR, when, type Tone,
} from "../../ui";
import { useCopiesChanged } from "./AddPaperBook";

/* CSV import of paper books (ADR-0117): upload, review, apply. */

const ROWS = 50;
const MAX_BYTES = 10 * 1024 * 1024;

const ACTIONS: Record<PaperImportRow["action"], { label: string; tone: Tone }> = {
  new_book: { label: "New book", tone: "success" },
  add_copy: { label: "Adds a copy to a book you have", tone: "success" },
  reading_only: { label: "Only your reading", tone: "info" },
  needs_choice: { label: "Needs your choice", tone: "warning" },
  already: { label: "Already on paper", tone: "neutral" },
  not_owned: { label: "Not owned on paper", tone: "neutral" },
  skip: { label: "Left out", tone: "neutral" },
  unusable: { label: "Cannot be used", tone: "danger" },
};
const OUTCOMES: Record<string, { label: string; tone: Tone }> = {
  added: { label: "Added", tone: "success" },
  attached: { label: "Added to a book", tone: "success" },
  reading_added: { label: "Reading added", tone: "info" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const STATE = { review: "Waiting for review", applying: "Being applied", completed: "Applied" } as const;

function AdminsOnly() {
  return <Page><EmptyState title="Administrators import books">Adding paper books needs an administrator account with access to the library.</EmptyState></Page>;
}

/** Start an import, and the imports you have. */
export function PaperImportsPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Paged<Library>>("/libraries?size=200") });
  const imports = useQuery({ queryKey: ["paper-imports"], queryFn: () => get<PaperImports>("/admin/paper-imports"), enabled: !!user?.isAdmin });
  const [chosen, setLibrary] = useState("");
  const [rejected, setRejected] = useState("");
  const library = chosen || (libs.data?.items.length === 1 ? libs.data.items[0]!.id : "");
  const upload = useMutation({
    // Windows names CSV files as spreadsheets, so the type is set here.
    mutationFn: (f: File) => uploadFile<PaperImport>("POST", `/admin/paper-imports${qs({ libraryId: library })}`, new File([f], f.name, { type: "text/csv" })),
    onSuccess: (r) => nav(`/paper-imports/${r.id}`),
  });
  if (!user?.isAdmin) return <AdminsOnly />;
  const name = (id: string) => libs.data?.items.find((l) => l.id === id)?.name ?? "…";
  return (
    <Page narrow>
      <PageHeader title="Import paper books" description="Bring in a list of paper books from a Goodreads library export, or from the Litara template. You check every row before anything changes." />
      <Card framed>
        <Stack>
          <SelectField label="Library" description="Everyone with access to it sees the copies." placeholder="Choose a library" emptyText="No libraries yet"
            value={library || null} items={(libs.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))} onValue={(v) => setLibrary(v ?? "")} />
          {library
            ? <FileDrop label="Choose a CSV file" hint="Drop a CSV file here" accept={[".csv", "text/csv", "application/vnd.ms-excel"]} maxSize={MAX_BYTES} disabled={upload.isPending}
                onFile={(f) => { setRejected(""); upload.mutate(f); }} onReject={(tooLarge) => setRejected(tooLarge ? "That file is larger than 10 MB." : "Choose a CSV file.")} />
            : <Text size="sm" tone="dim">Choose a library first.</Text>}
          {upload.isPending && <Busy />}
          {rejected && <Alert tone="danger" role="alert">{rejected}</Alert>}
          <ErrorBox error={upload.error} />
          <div><DownloadLink href={`${API}/admin/paper-imports/template`}>Download the template</DownloadLink></div>
          <Text size="sm" tone="dim">The file may hold private reviews. Litara does not keep the file. Only you see an import, and one you do not apply is deleted after seven days. Private notes are never read.</Text>
        </Stack>
      </Card>
      <ErrorBox error={imports.error} />
      {(imports.data?.items.length ?? 0) > 0 && (
        <Stack gap="sm">
          <Heading level={2}>Your imports</Heading>
          <Table label="Your imports">
            <THead><TR><TH>Uploaded</TH><TH>Library</TH><TH num>Rows</TH><TH>State</TH></TR></THead>
            <TBody>
              {imports.data!.items.map((i) => (
                <TR key={i.id}>
                  <TD><TextLink to={`/paper-imports/${i.id}`}>{when(i.createdAt)}</TextLink></TD>
                  <TD>{name(i.libraryId)}</TD>
                  <TD num>{i.rows.toLocaleString()}</TD>
                  <TD><Badge tone={i.state === "completed" ? "success" : "warning"}>{STATE[i.state]}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Stack>
      )}
    </Page>
  );
}

const short = (title: string) => (title.length > 24 ? `${title.slice(0, 23)}…` : title);

/** The person's choice for a row that may be a book already in the catalogue. */
function MatchChoice({ row, onChange, disabled }: { row: PaperImportRow; onChange: (change: { choice: string; titleId?: string }) => void; disabled: boolean }) {
  const value = row.choice === "attach" && row.titleId ? `attach:${row.titleId}` : row.choice ?? "auto";
  const items = [
    { value: "auto", label: row.action === "needs_choice" ? "Not decided" : "Starting choice" },
    // Short enough to fit on one line; the row itself already shows the title and author being matched.
    ...row.matches.map((m, i) => ({ value: `attach:${m.titleId}`, label: `${m.sameIsbn ? "Same ISBN" : "Same title"}: ${short(m.title)}${row.matches.length > 1 ? ` (${i + 1})` : ""}` })),
    { value: "separate", label: "A separate book" },
    { value: "skip", label: "Leave this row out" },
  ];
  if (disabled) return null;
  return <CompactSelect label={`Which book is row ${row.row}, ${row.title}`} items={items} value={value}
    onValue={(v) => { if (!v || v === value) return; onChange(v.startsWith("attach:") ? { choice: "attach", titleId: v.slice(7) } : { choice: v }); }} />;
}

function RowsTable({ imp, show, onChanged }: { imp: PaperImport; show: string; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const review = imp.state === "review";
  const rows = useQuery({
    queryKey: ["paper-import", imp.id, "rows", show, page, imp.revision],
    queryFn: () => get<PaperImportRows>(`/admin/paper-imports/${imp.id}/rows${qs({ show, page: page - 1, size: ROWS })}`),
    placeholderData: (previous) => previous,
  });
  const change = useMutation({
    mutationFn: (v: { row: number; body: Record<string, unknown> }) => api<PaperImportRow>("PUT", `/admin/paper-imports/${imp.id}/rows/${v.row}`, v.body),
    onSettled: onChanged,
  });
  if (!rows.data) return rows.error ? <ErrorBox error={rows.error} /> : <Busy />;
  const pages = Math.max(1, Math.ceil(rows.data.total / ROWS));
  if (rows.data.total === 0) return <Text tone="dim">No rows in this list.</Text>;
  return (
    <Stack gap="sm">
      <ErrorBox error={rows.error ?? change.error} />
      <Table label="Rows of the file">
        <THead><TR><TH num>Row</TH>{review && <TH>Own on paper</TH>}<TH>Book</TH><TH>{review ? "What happens" : "What happened"}</TH></TR></THead>
        <TBody>
          {rows.data.items.map((r) => {
            const done = r.outcome ? OUTCOMES[r.outcome] : undefined;
            const would = ACTIONS[r.action];
            return (
              <TR key={r.row} data-testid="import-row">
                <TD num>{r.row}</TD>
                {review && (
                  <TD>
                    <CheckboxField label={<span className="lt-sr">I own row {r.row}, {r.title || "no title"}, on paper</span>} checked={r.selected}
                      disabled={r.action === "unusable" || change.isPending} onChange={(selected) => change.mutate({ row: r.row, body: { selected } })} />
                  </TD>
                )}
                <TD>
                  <Stack gap="xs">
                    {r.titleId && !review ? <TextLink to={`/titles/${r.titleId}`}>{r.title || "(no title)"}</TextLink> : <Text as="span" strong>{r.title || "(no title)"}</Text>}
                    <Text as="span" size="sm" tone="dim">{[r.authors.join(", "), r.isbn ? `ISBN ${r.isbn}` : "", r.shelves.join(", ")].filter(Boolean).join(" · ")}</Text>
                    {r.problems.map((p) => <Text key={p} size="sm" tone="warning">{p}</Text>)}
                  </Stack>
                </TD>
                <TD>
                  <Stack gap="xs">
                    <div>{done ? <Badge tone={done.tone}>{done.label}</Badge> : <Badge tone={would.tone}>{would.label}</Badge>}
                      {review && r.selected && r.copies > 1 && (r.action === "new_book" || r.action === "add_copy") && <Text as="span" size="sm" tone="dim"> {r.copies} copies</Text>}</div>
                    {r.detail && <Text size="sm" tone="dim">{r.detail}</Text>}
                    {r.matches.length > 1 && <Text size="xs" tone="dim">{r.matches.map((m, i) => `(${i + 1}) ${m.title}${m.authors.length ? ` by ${m.authors.join(", ")}` : ""}`).join("; ")}</Text>}
                    {r.matches.length > 0 && <MatchChoice row={r} disabled={!review || change.isPending} onChange={(body) => change.mutate({ row: r.row, body })} />}
                  </Stack>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {pages > 1 && <Pager label="Pages of rows" page={Math.min(page, pages)} pageCount={pages} onPage={setPage} />}
    </Stack>
  );
}

function Review({ imp, onChanged }: { imp: PaperImport; onChanged: () => void }) {
  const [show, setShow] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();
  const options = useMutation({
    mutationFn: (v: { ownership: string | null; shelves: string[]; includeReading: boolean }) => api<PaperImport>("PUT", `/admin/paper-imports/${imp.id}/options`, v),
    onSuccess: (r) => qc.setQueryData(["paper-import", imp.id], r),
  });
  const apply = useMutation({
    mutationFn: () => api<PaperImport>("POST", `/admin/paper-imports/${imp.id}/apply`, { baseRevision: imp.revision }),
    onSuccess: (r) => qc.setQueryData(["paper-import", imp.id], r),
    onSettled: () => { setConfirming(false); onChanged(); },
  });
  const set = (v: Partial<{ ownership: string | null; shelves: string[]; includeReading: boolean }>) =>
    options.mutate({ ownership: imp.ownership, shelves: imp.shelves, includeReading: imp.includeReading, ...v });
  const plan = imp.plan!;
  const changes = plan.newBook + plan.addCopy + plan.readingOnly;
  const left = plan.already + plan.notOwned + plan.skipped + plan.unusable;
  return (
    <Stack>
      <Card framed>
        <Stack>
          <SelectField label="Which books in this file do you own on paper?" placeholder="Choose an answer" value={imp.ownership}
            description="You can still change any row below."
            items={[
              { value: "all", label: "All of them" },
              { value: "owned", label: `Those marked as owned (${count(imp.markedOwned, "row")})` },
              { value: "shelves", label: "Those on shelves I choose" },
              { value: "pick", label: "I'll pick them" },
            ]}
            onValue={(v) => { if (v && v !== imp.ownership) set({ ownership: v, shelves: [] }); }} />
          {imp.ownership === "shelves" && (
            <Row gap="xs" wrap role="group" aria-label="Shelves that hold books you own on paper">
              {imp.fileShelves.length === 0 && <Text size="sm" tone="dim">The file names no shelves.</Text>}
              {imp.fileShelves.map((s) => (
                <ToggleChip key={s.name} label={`${s.name} (${s.rows})`} pressed={imp.shelves.includes(s.name)} disabled={options.isPending}
                  onChange={(on) => set({ shelves: on ? [...imp.shelves, s.name] : imp.shelves.filter((x) => x !== s.name) })} />
              ))}
            </Row>
          )}
          <CheckboxField label="These are my ratings, reviews and reading" checked={imp.includeReading} disabled={options.isPending || imp.withReading === 0}
            onChange={(includeReading) => set({ includeReading })}
            description={imp.withReading === 0 ? "The file has none." : `Adds them to your account only, from ${count(imp.withReading, "row")}. Nothing you have saved is replaced. A book on your read shelf counts as read on paper.`} />
          <ErrorBox error={options.error} />
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={2}>What applying will do</Heading>
          <Text data-testid="import-plan">
            {count(plan.copies, "paper copy", "paper copies")}: {count(plan.newBook, "row")} for new books, {count(plan.addCopy, "row")} for books you have.
            {imp.includeReading ? ` ${count(plan.readingOnly, "row")} add only your reading.` : ""} {count(left, "row")} left out.
          </Text>
          {plan.needsChoice > 0 && <Alert tone="warning" title={`${count(plan.needsChoice, "row needs", "rows need")} your choice`}>
            These may be books you already have. A row you do not decide is skipped.
            <div><Button size="sm" icon={icons.filter} onClick={() => setShow("choose")}>Show them</Button></div>
          </Alert>}
          {!imp.ownership && <Text size="sm" tone="warning">Say which books you own on paper before applying.</Text>}
          {apply.error instanceof ApiError && apply.error.code === "stale_revision"
            ? <Text size="sm" tone="warning" role="alert">The import changed, so it was not applied. Check it and try again.</Text>
            : <ErrorBox error={apply.error} />}
          <Row gap="sm" wrap>
            <Button variant="primary" icon={icons.check} disabled={!imp.ownership || changes === 0 || options.isPending} onClick={() => setConfirming(true)}>Apply import</Button>
          </Row>
        </Stack>
      </Card>

      <SelectField label="Show" value={show} onValue={(v) => setShow(v ?? "all")}
        items={[
          { value: "all", label: "All rows" }, { value: "choose", label: "Need a choice" }, { value: "copies", label: "Will make copies" },
          { value: "reading", label: "Only your reading" }, { value: "left", label: "Left out" }, { value: "problems", label: "With a problem" },
        ]} />
      <RowsTable key={show} imp={imp} show={show} onChanged={onChanged} />

      <ConfirmDialog open={confirming} title="Apply this import?" confirmLabel="Apply import" loading={apply.isPending} onCancel={() => setConfirming(false)} onConfirm={() => apply.mutate()}>
        {`This adds ${count(plan.copies, "paper copy", "paper copies")}${imp.includeReading ? " and your reading" : ""}. It cannot be undone in one step: copies are removed one at a time.${plan.needsChoice > 0 ? ` ${count(plan.needsChoice, "undecided row is", "undecided rows are")} skipped.` : ""}`}
      </ConfirmDialog>
    </Stack>
  );
}

function Applied({ imp }: { imp: PaperImport }) {
  const r = imp.result!;
  const total = r.added + r.attached + r.readingAdded + r.skipped + r.failed + r.waiting;
  const done = total - r.waiting;
  return (
    <Stack>
      <Card framed>
        <Stack gap="sm">
          {imp.state === "applying" ? (
            <>
              <Heading level={2}>Applying the import</Heading>
              <ProgressBar label="Rows applied" value={total ? Math.round((done / total) * 100) : 0} />
              <Text size="sm" tone="dim" data-testid="import-progress">{done.toLocaleString()} of {total.toLocaleString()} rows. You can leave this page; the import carries on.</Text>
            </>
          ) : (
            <>
              <Heading level={2}>Import applied</Heading>
              <Text data-testid="import-result">
                {count(r.added, "new book")} added, {count(r.attached, "row")} added to a book, {count(r.readingAdded, "row")} added only your reading,
                {" "}{count(r.skipped, "row")} skipped{r.failed ? `, ${count(r.failed, "row")} failed` : ""}.
              </Text>
              <div><DownloadLink href={`${API}/admin/paper-imports/${imp.id}/report`}>Download the report</DownloadLink></div>
            </>
          )}
        </Stack>
      </Card>
      {imp.state === "completed" && <RowsTable imp={imp} show="all" onChanged={() => {}} />}
    </Stack>
  );
}

/** One import: the review, then its progress and result. */
export function PaperImportPage() {
  const { importId = "" } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const changed = useCopiesChanged();
  const [removing, setRemoving] = useState(false);
  const key = ["paper-import", importId];
  const imp = useQuery({
    queryKey: key, enabled: !!user?.isAdmin,
    queryFn: async () => {
      const next = await get<PaperImport>(`/admin/paper-imports/${importId}`);
      const before = qc.getQueryData<PaperImport>(key);
      if (next.state === "completed" && before?.state === "applying") changed();
      return next;
    },
    refetchInterval: (q) => (q.state.data?.state === "applying" ? 1500 : false),
  });
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", `/admin/paper-imports/${importId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["paper-imports"] }); nav("/paper-imports"); },
    onSettled: () => setRemoving(false),
  });
  if (!user?.isAdmin) return <AdminsOnly />;
  if (imp.isPending) return <Busy />;
  if (imp.error) return <Page><ErrorBox error={imp.error} /><div><Button icon={icons.arrowLeft} to="/paper-imports">All imports</Button></div></Page>;
  const data = imp.data;
  const review = data.state === "review";
  return (
    <Page>
      <PageHeader title={review ? "Review import" : "Import"} description={`${count(data.rows, "row")} from ${data.source === "goodreads" ? "a Goodreads export" : "a Litara file"}, uploaded ${when(data.createdAt)}.`}
        actions={<>
          <Button icon={icons.arrowLeft} to="/paper-imports">All imports</Button>
          {data.state !== "applying" && <Button variant="subtle" icon={icons.trash} onClick={() => setRemoving(true)}>{review ? "Cancel import" : "Remove report"}</Button>}
        </>} />
      <ErrorBox error={remove.error} />
      {review ? <Review imp={data} onChanged={() => void qc.invalidateQueries({ queryKey: key })} /> : <Applied imp={data} />}
      <ConfirmDialog open={removing} title={review ? "Cancel this import?" : "Remove this report?"} confirmLabel={review ? "Cancel import" : "Remove report"} danger loading={remove.isPending}
        onCancel={() => setRemoving(false)} onConfirm={() => remove.mutate()}>
        {review ? "The rows you uploaded and your choices are deleted. Nothing in the catalogue changes." : "The report is deleted. Books, copies and reading that were added stay."}
      </ConfirmDialog>
    </Page>
  );
}
