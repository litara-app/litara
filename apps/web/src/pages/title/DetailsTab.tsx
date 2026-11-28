import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../../api/client";
import type { Annotation, AudioRecording, Edition, EditionDetails, Library, RecordingDetails, Page as Paged, PositionState, RecordingLink, TitleDetail } from "../../api/types";
import {
  Badge, bytes, Button, CapBadge, DateField, dateToIso, duration, ErrorBox, FormatTag, IconAction, icons, isoToDate, Ledger, Drawer, Modal, Panel, Quote, Row, Stack,
  StatusPill, Text, TextAreaField, TextLink, when,
} from "../../ui";
import { isReadable } from "../useTitleActions";
import { usePersonal } from "./usePersonal";
import { authorPath, seriesPath } from "../directories/directory";
import { PaperCopies, useTitleCopies } from "../paper/PaperCopies";

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
const published = (p: string | null | undefined) => {
  if (!p) return "–";
  const [y, m, d] = p.split("-");
  if (!m) return y;
  return new Date(Number(y), Number(m) - 1, Number(d ?? 1)).toLocaleDateString(undefined, d ? { dateStyle: "medium" } : { year: "numeric", month: "long" });
};

/** The summary tab: synopsis, your review and reading, highlights, and the facts about the book. */
export function DetailsTab({ detail, editions, recordings, onTab }: {
  detail: TitleDetail; editions: Edition[]; recordings: RecordingLink[]; onTab: (tab: string) => void;
}) {
  const t = detail.title;
  const personal = usePersonal(t.id);
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Paged<Library>>("/libraries?size=200") });
  const positions = useQueries({ queries: editions.map((e) => ({ queryKey: ["edition", e.id, "position"], queryFn: () => get<PositionState>(`/editions/${e.id}/position`) })) });
  const notes = useQueries({ queries: editions.map((e) => ({ queryKey: ["annotations", e.id], queryFn: () => get<Paged<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) })) });
  const audio = useQueries({ queries: recordings.map((r) => ({ queryKey: ["recording", r.id], queryFn: () => get<AudioRecording>(`/recordings/${r.id}`) })) });
  const extra = useQueries({ queries: editions.map((e) => ({ queryKey: ["edition", e.id, "details"], queryFn: () => get<EditionDetails>(`/editions/${e.id}/details`) })) });
  const audioExtra = useQueries({ queries: recordings.map((r) => ({ queryKey: ["recording", r.id, "details"], queryFn: () => get<RecordingDetails>(`/recordings/${r.id}/details`) })) });

  const copies = useTitleCopies(t).data?.items ?? [];
  const paperOnly = editions.length === 0 && recordings.length === 0 && t.physicalCopyCount > 0;

  const [more, setMore] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dating, setDating] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const [finishedOn, setFinishedOn] = useState<string | null>(null);

  // Ebook editions first, then audiobook recordings: the first value anyone has is shown.
  const meta: Partial<EditionDetails & RecordingDetails>[] = [...extra, ...audioExtra].flatMap((x) => (x.data ? [x.data] : []));
  const pick = <K extends keyof EditionDetails>(k: K) => meta.map((m) => (m as EditionDetails)[k]).find((v) => v !== null && v !== undefined) as EditionDetails[K] | undefined;
  // A paper-only book has no edition or recording to read these from: its own details and its copies do (ADR-0116).
  const synopsis = pick("description") ?? detail.description ?? undefined;
  const added = [...meta.map((m) => m.addedAt as string), ...copies.map((c) => c.addedAt)].sort()[0];
  const library = libs.data?.items.find((l) => l.id === editions[0]?.libraryId || l.id === recordings[0]?.libraryId || l.id === copies[0]?.libraryId);
  const highlights = notes.flatMap((n) => n.data?.items ?? []).filter((a) => !a.deleted && a.data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const quotes = highlights.filter((a) => a.data!.quote);
  const finished = editions.filter((e) => e.completion.finished).length;
  const totalBytes = editions.reduce((n, e) => n + (e.file.sizeBytes ?? 0), 0);
  const listen = audio.flatMap((a) => (a.data ? [a.data] : []));
  const p = personal.data;
  const startedAt = p?.data.startedAt ?? p?.derivedStartedAt ?? null;
  const finishedAt = p?.data.finishedAt ?? p?.derivedFinishedAt ?? null;
  const edited = (own: string | null | undefined) => (own ? " (set by you)" : "");

  const openDates = () => { setStarted(isoToDate(startedAt)); setFinishedOn(isoToDate(finishedAt)); setDating(true); personal.save.reset(); };
  const openReview = () => { setDraft(p?.data.review ?? ""); setReviewing(true); personal.save.reset(); };

  return (
    <div className="lt-folio-grid">
      <Stack>
        <Panel title="Synopsis">
          {synopsis ? (
            <Stack gap="sm">
              <Text clamp={more ? undefined : 6} data-testid="synopsis">{synopsis}</Text>
              {synopsis.length > 320 && <div><Button size="sm" variant="subtle" onClick={() => setMore(!more)} icon={more ? icons.caret : icons.chevDown}>{more ? "Show less" : "Show more"}</Button></div>}
            </Stack>
          ) : <Text tone="dim">{paperOnly ? "No synopsis. An administrator can add one under Edit metadata." : "No synopsis. The book file has none; an administrator can add one under Edit metadata."}</Text>}
        </Panel>

        <PaperCopies title={t} />

        <Panel title="Your review" aside="private">
          <Stack gap="sm">
            {p?.data.review ? <Text>{p.data.review}</Text> : <Text tone="dim">Not written yet. Only you can see your review.</Text>}
            <div><Button size="sm" onClick={openReview} disabled={!personal.ready} icon={icons.pencil}>{p?.data.review ? "Edit review" : "Write review"}</Button></div>
          </Stack>
        </Panel>

        {!paperOnly && <Panel title="Your reading" aside={editions.length === 0 ? undefined : finished === editions.length ? "finished" : finished > 0 ? `${finished} of ${editions.length} finished` : "not finished"}>
          <Stack gap="sm">
            {editions.length === 0 && <Text tone="dim">This title has no ebook edition. Audiobook progress is kept on the recording.</Text>}
            {editions.map((e, i) => {
              const pos = positions[i]?.data?.position ?? null;
              return (
                <Row key={e.id} justify="between" wrap>
                  <Stack gap="xs">
                    <Row gap="xs"><FormatTag format={e.file.format} /><Text as="span" strong>{e.label || e.file.format.toUpperCase()}</Text>{e.completion.finished && <StatusPill state="finished" />}</Row>
                    <Text size="sm" tone="dim">{pos ? `Resume point saved ${when(pos.capturedAt)} on ${pos.deviceName || "another device"}.` : "No place saved yet."}</Text>
                  </Stack>
                  {isReadable(e) && <Button size="sm" variant={pos ? "primary" : "default"} to={`/read/${e.id}`} icon={icons.bookOpen}>{pos ? "Resume" : "Start reading"}</Button>}
                </Row>
              );
            })}
            {editions.length > 0 && <div><Button size="sm" variant="subtle" onClick={() => onTab("log")} icon={icons.clock}>Reading log</Button></div>}
          </Stack>
        </Panel>}

        {!paperOnly && <Panel title="Highlights" aside={highlights.length > 0 ? `${highlights.length}` : undefined}>
          <Stack gap="sm">
            {quotes.slice(0, 2).map((a) => <Quote key={a.id}>{a.data!.quote}</Quote>)}
            {highlights.length === 0 && <Text tone="dim">Nothing highlighted yet. Select text while reading to keep it here.</Text>}
            {highlights.length > 0 && <div><Button size="sm" variant="subtle" onClick={() => onTab("highlights")} icon={icons.highlight}>All highlights</Button></div>}
          </Stack>
        </Panel>}

        {editions.length > 0 && (
          <Panel title="What you can do">
            <Stack gap="sm">
              {editions.map((e) => (
                <Row key={e.id} gap="xs" wrap>
                  <FormatTag format={e.file.format} />
                  {(Object.keys(e.capabilities) as (keyof typeof e.capabilities)[]).map((k) => <CapBadge key={k} name={k} cap={e.capabilities[k]} />)}
                </Row>
              ))}
            </Stack>
          </Panel>
        )}
      </Stack>

      <Stack>
        <Panel title="Details">
          <Ledger items={[
            ["Authors", t.authors.length ? t.authors.map((a, i) => <span key={i}>{i > 0 && ", "}<TextLink to={authorPath(a)}>{a}</TextLink></span>) : "Unknown"],
            ["Series", t.series.length ? t.series.map((x, i) => <span key={i}>{i > 0 && ", "}<TextLink to={seriesPath(x)}>{x}</TextLink></span>) : "None"],
            ["Languages", t.languages.join(", ") || "Unknown"],
            ["Publisher", pick("publisher") ?? detail.publisher ?? "–"],
            ["Published", published(pick("published") ?? detail.published)],
            ["Pages", pick("pageCount") ?? copies.find((c) => c.pageCount)?.pageCount ?? "–"],
            ["ISBN", pick("isbn") ?? copies.find((c) => c.isbn)?.isbn ?? "–"],
            ["Library", library?.name ?? "…"],
            ["Ebooks", editions.length],
            ["Audiobooks", recordings.length],
            ["Paper copies", t.physicalCopyCount],
            ["File size", totalBytes > 0 ? bytes(totalBytes) : "–"],
            ["Added", day(added)],
            [`Date started${edited(p?.data.startedAt)}`, <Row key="s" gap="xs">{day(startedAt)}<IconAction label="Change dates" icon={icons.pencil} onClick={openDates} disabled={!personal.ready} /></Row>],
            [`Date finished${edited(p?.data.finishedAt)}`, day(finishedAt)],
          ]} />
        </Panel>
        {!paperOnly && <Panel title="Editions" aside={`${editions.length + recordings.length} ${editions.length + recordings.length === 1 ? "file set" : "file sets"}`}>
          <Stack gap="sm">
            {editions.map((e) => (
              <Row key={e.id} justify="between">
                <Row gap="xs"><FormatTag format={e.file.format} /><TextLink to={`/editions/${e.id}`}>{e.label || e.file.format.toUpperCase()}</TextLink></Row>
                <Text as="span" size="sm" tone="dim">{bytes(e.file.sizeBytes)}</Text>
              </Row>
            ))}
            {listen.map((r) => (
              <Row key={r.id} justify="between">
                <Row gap="xs"><Badge tone="audio">Audio</Badge><Text as="span">{r.title || "Recording"}</Text></Row>
                <Text as="span" size="sm" tone="dim">{duration(r.durationMs)}</Text>
              </Row>
            ))}
            {editions.length + recordings.length === 0 && <Text tone="dim">No files yet.</Text>}
          </Stack>
        </Panel>}
      </Stack>

      <Modal open={reviewing} onClose={() => setReviewing(false)} title="Your review" description="Private. Only you can read it."
        actions={<>
          <Button onClick={() => setReviewing(false)} icon={icons.close}>Cancel</Button>
          <Button variant="primary" loading={personal.save.isPending} icon={icons.save}
            onClick={() => personal.save.mutate({ review: draft }, { onSuccess: () => setReviewing(false) })}>Save</Button>
        </>}>
        <TextAreaField label="Review" value={draft} onValue={setDraft} rows={8} maxLength={20000} />
        <ErrorBox error={personal.save.error} />
      </Modal>

      <Drawer open={dating} onClose={() => setDating(false)} title="Dates" description="Litara works these out from your reading. Set a date to keep your own; clear it to follow your reading again."
        actions={<>
          <Button onClick={() => setDating(false)} icon={icons.close}>Cancel</Button>
          <Button loading={personal.save.isPending} icon={icons.reset}
            onClick={() => personal.save.mutate({ startedAt: null, finishedAt: null }, { onSuccess: () => setDating(false) })}>Use my reading</Button>
          <Button variant="primary" loading={personal.save.isPending} icon={icons.save}
            onClick={() => personal.save.mutate({ startedAt: dateToIso(started), finishedAt: dateToIso(finishedOn) }, { onSuccess: () => setDating(false) })}>Save</Button>
        </>}>
        <Stack>
          <DateField label="Date started" value={started} onValue={setStarted} />
          <DateField label="Date finished" value={finishedOn} onValue={setFinishedOn} />
        </Stack>
        <ErrorBox error={personal.save.error} />
      </Drawer>
    </div>
  );
}
