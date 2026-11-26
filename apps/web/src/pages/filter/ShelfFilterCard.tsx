import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, op } from "../../api/client";
import type { Shelf, ShelfData } from "../../api/types";
import { Alert, Button, Card, ErrorBox, Heading, icons, Row, Stack, Text } from "../../ui";
import { FilterEditor } from "./FilterBuilder";
import { fromWire, hasListValue, isSavable, toWire, type DraftGroup, type WireFilter } from "./filterTree";
import { useLibraries } from "./useLibraries";

/** The owner's editor for a smart shelf's filter (ADR-0107): the library rule builder, saved at the shelf's revision. */
export function ShelfFilterCard({ shelf, data, filter, onSaved }: { shelf: Shelf; data: ShelfData; filter: WireFilter; onSaved: () => void }) {
  const [draft, setDraft] = useState<DraftGroup | null>(null);
  const libraries = useLibraries();
  // The revision the draft was opened at, so a change made elsewhere since then is refused rather than overwritten.
  const [base, setBase] = useState(shelf.revision);
  const save = useMutation({
    mutationFn: (next: WireFilter) => api("PUT", `/shelves/${shelf.id}`, { ...op(base), data: { ...data, filter: next } }),
    onSuccess: () => setDraft(null),
    onSettled: onSaved,
  });
  const stale = save.error instanceof ApiError && (save.error.status === 409 || save.error.status === 412);
  const close = () => { setDraft(null); save.reset(); };

  if (hasListValue(filter)) {
    return <Text size="sm" tone="dim">This filter has a rule with several values, which cannot be edited here.</Text>;
  }
  if (!draft) {
    return <Row><Button icon={icons.pencil} onClick={() => { setBase(shelf.revision); setDraft(fromWire(filter)); }}>Edit filter</Button></Row>;
  }
  const savable = isSavable(draft);
  return (
    <Card framed data-testid="shelf-filter">
      <Stack gap="sm">
        <Heading level={3}>Shelf filter</Heading>
        <FilterEditor root={draft} setRoot={setDraft} libraries={libraries} />
        {!savable && <Text size="sm" tone="dim">Add at least one filter, and complete or remove each one, to save.</Text>}
        {stale && <Alert tone="warning" role="alert">This shelf changed elsewhere, so the filter was not saved. Cancel, then edit the current filter.</Alert>}
        {!stale && <ErrorBox error={save.error} />}
        <Row gap="xs">
          <Button variant="primary" icon={icons.check} loading={save.isPending} disabled={!savable} onClick={() => save.mutate(toWire(draft)!)}>Save filter</Button>
          <Button icon={icons.close} onClick={close}>Cancel</Button>
        </Row>
      </Stack>
    </Card>
  );
}
