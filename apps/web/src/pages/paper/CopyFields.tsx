import { useQuery } from "@tanstack/react-query";
import { get, qs } from "../../api/client";
import type { CopyLocations } from "../../api/types";
import { DateField, NumberField, Row, SelectField, Stack, Text, TextAreaField, TextField, ToggleChip } from "../../ui";
import { BINDINGS, type CopyForm } from "./paper";

/** The details of one printing and where it is. Everything is optional. */
export function CopyFields({ value, onValue, libraryId }: { value: CopyForm; onValue: (v: CopyForm) => void; libraryId: string }) {
  const set = <K extends keyof CopyForm>(k: K, v: CopyForm[K]) => onValue({ ...value, [k]: v });
  const used = useQuery({
    queryKey: ["admin", "copy-locations", libraryId], enabled: !!libraryId,
    queryFn: () => get<CopyLocations>(`/admin/physical-copy-locations${qs({ libraryId })}`),
  });
  const typed = value.location.trim().toLowerCase();
  const suggestions = (used.data?.items ?? []).filter((l) => l !== value.location && l.toLowerCase().includes(typed)).slice(0, 6);
  return (
    <Stack>
      <TextField label="Location" description="Where this copy is kept, for example Study, second shelf." value={value.location} onValue={(v) => set("location", v)} maxLength={200} />
      {suggestions.length > 0 && (
        <Row gap="xs" wrap role="group" aria-label="Locations used before">
          <Text as="span" size="sm" tone="dim">Used before:</Text>
          {suggestions.map((l) => <ToggleChip key={l} label={l} pressed={false} onChange={() => set("location", l)} />)}
        </Row>
      )}
      <SelectField label="Binding" clearable placeholder="Not recorded" items={BINDINGS} value={value.binding} onValue={(v) => set("binding", v)} />
      <TextField label="ISBN" description="Of this printing." value={value.isbn} onValue={(v) => set("isbn", v)} maxLength={32} />
      <NumberField label="Pages in this copy" value={value.pageCount} onValue={(v) => set("pageCount", v)} min={1} max={100000} step={1} />
      <TextField label="Language" description="A language code, for example en." value={value.language} onValue={(v) => set("language", v)} maxLength={35} />
      <DateField label="Date acquired" value={value.acquiredOn} onValue={(v) => set("acquiredOn", v)} />
      <TextAreaField label="Note" description="Everyone who can see this copy sees the note." value={value.note} onValue={(v) => set("note", v)} rows={3} maxLength={2000} />
    </Stack>
  );
}
