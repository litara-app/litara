import { useState } from "react";
import { api } from "../../api/client";
import type { Edition, RecordingLink } from "../../api/types";
import { Button, Row, Stack, Text, icons } from "../../ui";
import { WritebackDrawer, type Writeback } from "./WritebackDrawer";

type Medium = "ebook" | "audio";

/**
 * Write the stored cover into the book file (ADR-0086, phase 2). It uses the same reviewed plan as any in-file write: the
 * format's writer must be turned on, nothing is written until the exact change is approved, and each file is staged,
 * checked and replaced atomically. Litara's own copy of the cover is never affected by what happens to a file.
 */
export function CoverEmbed({ medium, editions, recordings }: { medium: Medium; editions: Edition[]; recordings: RecordingLink[] }) {
  const [open, setOpen] = useState<{ key: string; label: string; start: () => Promise<Writeback[]> } | null>(null);
  const targets = medium === "ebook"
    ? editions.map((e) => ({
      key: e.id, label: `${e.file.format.toUpperCase()} file`,
      start: async () => [await api<Writeback>("POST", `/admin/files/${e.file.id}/cover-writebacks`, { medium: "ebook" })],
    }))
    : recordings.map((r) => ({
      key: r.id, label: r.label || "audiobook files",
      start: async () => (await api<{ items: Writeback[] }>("POST", `/admin/recordings/${r.id}/cover-writebacks`)).items,
    }));
  if (targets.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text size="sm" tone="dim">The cover Litara shows can also be written into the {medium === "ebook" ? "book file" : "audiobook files"} itself, so other readers and devices show it. This changes the files, so you review and approve it first.</Text>
      <Row gap="sm" wrap>
        {targets.map((t) => <Button key={t.key} icon={icons.pencil} onClick={() => setOpen(t)}>Write into {t.label}…</Button>)}
      </Row>
      {open && (
        <WritebackDrawer key={open.key} testId="cover-embed" start={open.start} onClose={() => setOpen(null)}
          title={`Write the cover into ${open.label}`}
          description="This replaces or adds the cover picture inside the file. Everything else in the file stays as it is."
          intro="The file is changed on disk and gets a new version. A backup copy is kept only if backups are turned on for this library. Each write is checked before it replaces the file, and is refused if the file or the cover changed after you reviewed it."
          done={(n) => `The cover is now inside ${n === 1 ? "the file" : "the files"}. Run a scan if you want the catalog to pick up the new file versions.`} />
      )}
    </Stack>
  );
}
