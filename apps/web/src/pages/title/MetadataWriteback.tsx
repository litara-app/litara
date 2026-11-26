import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, get } from "../../api/client";
import type { AudioRecording, Edition, MetadataReport } from "../../api/types";
import { icons, Button, CheckboxField, ErrorBox, Heading, Row, Stack, Text } from "../../ui";
import { FIELDS, show } from "./metadataFields";
import { WritebackDrawer, type Writeback } from "./WritebackDrawer";

/** The fields each in-file writer accepts (ADR-0081). The server has the final say when it plans the write. */
const AUDIO_FIELDS = ["title", "publisher", "published", "isbn", "description"];
const WRITABLE: Record<string, string[]> = {
  epub: ["title", "authors", "series_name", "series_index", "publisher", "published", "isbn", "description"],
  mp3: AUDIO_FIELDS, flac: AUDIO_FIELDS, m4a: AUDIO_FIELDS, m4b: AUDIO_FIELDS,
};

/**
 * Put what Litara shows onto disk, as a sidecar beside the book (ADR-0053) or inside the file where that format's writer
 * is turned on (ADR-0048, ADR-0052). Both are reviewed plans; saving metadata on this tab never changes a file.
 */
export function MetadataWriteback({ target, edition, report }: {
  target: { id: string; kind: "edition" | "recording"; label: string };
  /** The edition being edited, when the target is an ebook. */
  edition?: Edition;
  report: MetadataReport;
}) {
  const [open, setOpen] = useState<"sidecar" | "file" | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const writers = useQuery({ queryKey: ["admin", "writers"], queryFn: () => get<{ items: { format: string; enabled: boolean }[] }>("/admin/writers") });
  const recording = useQuery({
    queryKey: ["recording", target.id, "files"], enabled: target.kind === "recording",
    queryFn: () => get<AudioRecording>(`/recordings/${target.id}`), retry: false,
  });
  const files = target.kind === "edition"
    ? (edition ? [{ id: edition.file.id, format: edition.file.format }] : [])
    : (recording.data?.files ?? []).map((f) => ({ id: f.id, format: (f.filename.split(".").pop() ?? "").toLowerCase() }));
  // A writer puts one set of values into one file. In every file of a split audiobook that would give each part the
  // book's title, so only a single-file recording is offered.
  const file = files.length === 1 ? files[0] : undefined;
  const enabled = !!file && !!writers.data?.items?.some((w) => w.format === file.format && w.enabled);
  const values = report.fields.filter((f) => !!file && !!WRITABLE[file.format]?.includes(f.field) && !f.cleared && f.value !== undefined && f.value !== null && f.value !== "");
  const chosen = values.filter((f) => !skipped.includes(f.field));
  const name = (field: string) => FIELDS.find((f) => f.field === field)?.label ?? field;

  const why = target.kind === "recording" && files.length > 1
    ? "Writing into the files is offered only for a single-file audiobook."
    : file && !WRITABLE[file.format] ? `Litara cannot write into ${file.format.toUpperCase()} files.`
    : file && writers.data && !enabled ? `Writing into ${file.format.toUpperCase()} files is turned off on this server.`
    : null;

  return (
    <Stack gap="sm" data-testid="metadata-writeback">
      <Heading level={3}>Write to disk</Heading>
      <Text size="sm" tone="dim">Saved details stay in Litara. You can also put them on disk. You review the exact change before anything is written.</Text>
      <ErrorBox error={writers.error ?? recording.error} />
      <Row gap="sm" wrap>
        <Button icon={icons.external} onClick={() => setOpen("sidecar")}>Export a sidecar file…</Button>
        {file && enabled && <Button icon={icons.pencil} disabled={chosen.length === 0} onClick={() => setOpen("file")}>Write into the {file.format.toUpperCase()} file…</Button>}
      </Row>
      {why && <Text size="sm" tone="dim">{why}</Text>}
      {enabled && values.length > 0 && (
        <Row gap="sm" wrap>
          {values.map((f) => (
            <CheckboxField key={f.field} checked={!skipped.includes(f.field)} label={`${name(f.field)}: ${show(f.value).slice(0, 60)}`}
              onChange={(on) => setSkipped((s) => (on ? s.filter((x) => x !== f.field) : [...s, f.field]))} />
          ))}
        </Row>
      )}
      {open === "sidecar" && (
        <WritebackDrawer testId="sidecar" showDiff onClose={() => setOpen(null)}
          start={async () => [await api<Writeback>("POST", `/admin/${target.kind}s/${target.id}/writebacks/sidecar`, {})]}
          title={`Export a sidecar for ${target.label}`}
          description="A Litara JSON file beside the book. The book file itself is not changed."
          intro="The next step shows where the file would go and what it would hold. An existing sidecar is replaced only if you approve that."
          done={() => "The sidecar file is written."} />
      )}
      {open === "file" && file && (
        <WritebackDrawer testId="file-write" showDiff onClose={() => setOpen(null)}
          start={async () => [await api<Writeback>("POST", `/admin/files/${file.id}/writebacks`, { changes: Object.fromEntries(chosen.map((f) => [f.field, f.value])) })]}
          title={`Write into the ${file.format.toUpperCase()} file`}
          description={`Only the chosen details change: ${chosen.map((f) => name(f.field)).join(", ")}.`}
          intro="The file is changed on disk and gets a new version, so saved places in it may no longer apply. A backup copy is kept only if backups are turned on for this library."
          done={() => "The details are now inside the file. Run a scan to pick up the new file version."} />
      )}
    </Stack>
  );
}
