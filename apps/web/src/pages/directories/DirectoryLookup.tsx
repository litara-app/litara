import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, qs } from "../../api/client";
import { Busy, Button, CheckboxField, ErrorBox, icons, Panel, ReviewValue, Row, SourceCredit, Stack, Text, Thumb } from "../../ui";
import {
  candidatePhotoPath, providerName, useDirectoryEdit, type DirectoryDetails, type DirectoryField, type DirectoryKind, type LookupCandidate, type LookupResults,
} from "./directoryDetails";

const STATUS_TEXT: Record<string, string> = {
  no_match: "found nothing", unavailable: "could not be reached. Try again later",
  unconfigured: "is turned on for a library, but the server has no access to it set up",
};

const FIELD_LABELS: Record<string, string> = { biography: "Biography", description: "Description", book_count: "Books in series", status: "Status" };

/** The values a candidate offers, as text to compare with what is saved. */
function offered(kind: DirectoryKind, c: LookupCandidate): { field: string; value: string }[] {
  const out = kind === "author"
    ? [{ field: "biography", value: c.biography ?? "" }]
    : [{ field: "description", value: c.description ?? "" }, { field: "book_count", value: c.bookCount ? String(c.bookCount) : "" }, { field: "status", value: c.status ?? "" }];
  return out.filter((v) => v.value !== "");
}

const statusName = (v: string) => (v === "complete" ? "Complete" : v === "ongoing" ? "Ongoing" : v);
const shown = (field: string, value: string) => (field === "status" ? statusName(value) : value);

/** "Use all" leaves locked fields and anything already saved: edits, applied values and deliberate clears (ADR-0097). */
const takenByUseAll = (f: DirectoryField | undefined) => !!f && !f.locked && f.source !== "user";

/**
 * Looks an author or a series up online, then reviews one result value by value (ADR-0102, ADR-0103). Nothing is saved
 * until Apply, and nothing is ticked in advance.
 */
export function DirectoryLookup({ kind, name, details }: { kind: DirectoryKind; name: string; details: DirectoryDetails }) {
  const [review, setReview] = useState<{ provider: string; candidate: LookupCandidate } | null>(null);
  const search = useMutation({
    mutationFn: (fresh: boolean) => api<LookupResults>("POST", `/${kind === "author" ? "authors" : "series"}/lookup${qs({ name })}`, fresh ? { fresh } : {}),
    onSuccess: () => setReview(null),
  });
  const close = () => { search.reset(); setReview(null); };

  return (
    <Stack gap="sm">
      <Row gap="sm" wrap>
        <Button variant="primary" icon={icons.search} loading={search.isPending} onClick={() => search.mutate(false)}>Find {kind} online</Button>
        {kind === "series" && <Text size="sm" tone="dim">Litara looks up books you already have in this series.</Text>}
      </Row>
      <ErrorBox error={search.error} />
      {search.isPending && <Busy />}
      {search.data && !review && (
        <Panel title="Online results" data-testid="lookup-results">
          <Stack gap="sm">
            {!search.data.enabled && <Text>No library of this {kind} has Hardcover or Open Library turned on. Turn one on in the library settings.</Text>}
            {search.data.results.map((r) => (
              <Stack key={r.provider} gap="xs">
                {r.status !== "ok" && <Text size="sm" tone="dim">{providerName(r.provider)} {STATUS_TEXT[r.status] ?? r.status}.</Text>}
                {r.candidates.map((c) => (
                  <Row key={c.id} gap="sm" justify="between" wrap data-testid="lookup-candidate">
                    <Stack gap="xs">
                      <Text strong>{c.name}</Text>
                      <Text size="sm" tone="dim">
                        {kind === "author" ? c.detail : `${c.matchedBooks} of ${c.searchedBooks} books searched point here · ${c.numberedBooks} numbered books listed`}
                      </Text>
                      <SourceCredit label="View on" provider={providerName(r.provider)} url={c.url} />
                    </Stack>
                    <Button icon={icons.check} onClick={() => setReview({ provider: r.provider, candidate: c })}>Review</Button>
                  </Row>
                ))}
              </Stack>
            ))}
            <Row gap="sm" wrap>
              {search.data.enabled && <Button icon={icons.reset} onClick={() => search.mutate(true)}>Search again</Button>}
              <Button icon={icons.close} onClick={close}>Close</Button>
            </Row>
          </Stack>
        </Panel>
      )}
      {review && (
        <Review key={`${review.provider}:${review.candidate.id}`} kind={kind} name={name} details={details} provider={review.provider} candidate={review.candidate}
          onBack={() => setReview(null)} onDone={close} />
      )}
    </Stack>
  );
}

function Review({ kind, name, details, provider, candidate, onBack, onDone }: {
  kind: DirectoryKind; name: string; details: DirectoryDetails; provider: string; candidate: LookupCandidate; onBack: () => void; onDone: () => void;
}) {
  const { save, busy, conflict } = useDirectoryEdit(kind, name);
  const values = offered(kind, candidate);
  const saved = (field: string) => details.fields.find((f) => f.field === field);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const hasPhoto = kind === "author" && !!candidate.hasPhoto;
  const photoLocked = !!details.photo?.locked;
  const chosen = values.filter((v) => picked.has(v.field) && !saved(v.field)?.locked).map((v) => v.field);
  const photo = hasPhoto && picked.has("photo") && !photoLocked;
  const count = chosen.length + (photo ? 1 : 0);
  const toggle = (key: string, on: boolean) => setPicked((p) => { const next = new Set(p); if (on) next.add(key); else next.delete(key); return next; });
  const useAll = () => setPicked(new Set([
    ...values.filter((v) => takenByUseAll(saved(v.field))).map((v) => v.field),
    ...(hasPhoto && !photoLocked && details.photo?.source === "none" ? ["photo"] : []),
  ]));
  const apply = () => save.mutate({
    kind: "apply", provider, candidateId: candidate.id, fields: chosen, photo,
    note: kind === "series" ? `Series matched to ${providerName(provider)}` : `Values from ${providerName(provider)} saved`,
  }, { onSuccess: onDone });

  return (
    <Panel title={`Review values from ${providerName(provider)}`} data-testid="lookup-review">
      <Stack gap="sm">
        <Text strong>{candidate.name}</Text>
        <SourceCredit label="View on" provider={providerName(provider)} url={candidate.url} />
        {hasPhoto && (
          <Stack gap="xs">
            <CheckboxField label="Use online photo" checked={photo} disabled={photoLocked} onChange={(on) => toggle("photo", on)} />
            <Thumb src={candidatePhotoPath(name, provider, candidate.id)} alt={`Photo offered by ${providerName(provider)}`} />
            {photoLocked ? <Text size="sm" tone="warning">The photo is locked. Unlock it before it can be replaced.</Text>
              : details.photo?.source !== "none" && <Text size="sm" tone="dim">There is a photo already, so Use all skips this. Tick it to replace it.</Text>}
          </Stack>
        )}
        {values.map((v) => {
          const f = saved(v.field);
          const label = FIELD_LABELS[v.field]!;
          return (
            <Stack key={v.field} gap="xs">
              <CheckboxField label={`Use online ${label}`} checked={chosen.includes(v.field)} disabled={!!f?.locked} onChange={(on) => toggle(v.field, on)} />
              <ReviewValue before={f?.value === null || f?.value === undefined ? "Not set" : shown(v.field, String(f.value))} after={shown(v.field, v.value)} />
              {f?.locked ? <Text size="sm" tone="warning">Locked. Unlock this field before it can be replaced.</Text>
                : f?.source === "user" && <Text size="sm" tone="dim">You saved this, so Use all skips it. Tick it to replace it.</Text>}
            </Stack>
          );
        })}
        {values.length === 0 && !hasPhoto && <Text tone="dim">This record has no values to bring in.</Text>}
        {kind === "series" && <Text size="sm" tone="dim">Matching this series shows the numbered books your libraries lack. It adds nothing to your catalog.</Text>}
        {conflict ? <Text size="sm" tone="warning" role="alert">This changed elsewhere, so it was refreshed. Check the values and apply again.</Text> : <ErrorBox error={save.error} />}
        <Row gap="sm" wrap>
          <Button variant="primary" icon={icons.save} loading={save.isPending} disabled={busy || (kind === "author" && count === 0)} onClick={apply}>
            {kind === "series" ? (count === 0 ? "Match series" : `Match and apply ${count} selected`) : `Apply ${count} selected`}
          </Button>
          {(values.length > 0 || hasPhoto) && <Button icon={icons.check} disabled={busy} onClick={useAll}>Use all</Button>}
          <Button icon={icons.arrowLeft} disabled={busy} onClick={onBack}>Back to results</Button>
        </Row>
      </Stack>
    </Panel>
  );
}
