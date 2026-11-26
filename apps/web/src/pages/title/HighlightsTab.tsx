import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { get } from "../../api/client";
import type { Annotation, Edition, Page } from "../../api/types";
import { Busy, EmptyState, ErrorBox, SegmentedField, Stack } from "../../ui";
import { AnnotationCard, KIND_LABEL, useAnnotationEditing } from "../annotations/annotationEditing";

type Kind = "all" | "highlight" | "note" | "bookmark";

/** Highlights, notes and bookmarks from every edition of this title. */
export function HighlightsTab({ editions }: { editions: Edition[] }) {
  const results = useQueries({
    queries: editions.map((e) => ({ queryKey: ["annotations", e.id], queryFn: () => get<Page<Annotation>>(`/editions/${e.id}/annotations?includeDeleted=false&size=200`) })),
  });
  const [kind, setKind] = useState<Kind>("all");
  const editing = useAnnotationEditing();

  const all = useMemo(() => results.flatMap((r) => r.data?.items ?? []).filter((a) => !a.deleted && a.data), [results]);
  const shown = all.filter((a) => kind === "all" || a.data!.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = (k: Kind) => all.filter((a) => k === "all" || a.data!.kind === k).length;
  const editionOf = (a: Annotation) => editions.find((e) => e.id === a.editionId);

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
        const e = editionOf(a);
        return <AnnotationCard key={a.id} a={a} source={e && (e.label || e.file.format.toUpperCase())} readerTo={e && `/read/${e.id}`}
          onEdit={() => editing.edit(a)} onRemove={() => editing.remove(a)} />;
      })}
      {editing.dialogs}
    </Stack>
  );
}
