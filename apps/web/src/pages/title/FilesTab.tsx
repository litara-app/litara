import { useQueries } from "@tanstack/react-query";
import { get } from "../../api/client";
import type { AudioRecording, Edition, RecordingLink } from "../../api/types";
import { icons, Badge, Busy, bytes, Button, Card, DownloadLink, duration, EmptyState, ErrorBox, FormatTag, Heading, Row, Stack, StatusPill, Table, TBody, TD, Text, TextLink, TH, THead, TR } from "../../ui";

/** Every file behind this title: ebook editions and the audio files of each recording. */
export function FilesTab({ editions, recordings }: { editions: Edition[]; recordings: RecordingLink[] }) {
  const audio = useQueries({
    queries: recordings.map((r) => ({ queryKey: ["recording", r.id], queryFn: () => get<AudioRecording>(`/recordings/${r.id}`) })),
  });
  return (
    <Stack>
      <Stack gap="sm">
        <Heading level={2}>Ebook and comic files</Heading>
        {editions.length === 0 ? <EmptyState level={3} title="No ebook files" /> : (
          <Table label="Ebook files">
            <THead><TR><TH>Edition</TH><TH>Format</TH><TH num>Size</TH><TH>State</TH><TH>Actions</TH></TR></THead>
            <TBody>
              {editions.map((e) => (
                <TR key={e.id}>
                  <TD><TextLink to={`/editions/${e.id}`}>{e.label || e.file.format.toUpperCase()}</TextLink>{e.language && <Text size="xs" tone="dim">{e.language}</Text>}</TD>
                  <TD><FormatTag format={e.file.format} /></TD>
                  <TD num>{bytes(e.file.sizeBytes)}</TD>
                  <TD><Row gap="xs" wrap><StatusPill state={e.readiness} />{e.file.availability !== "available" && <Badge tone="warning">{e.file.availability}</Badge>}</Row></TD>
                  <TD>
                    <Row gap="xs">
                      <Button size="sm" to={`/read/${e.id}`} disabled={e.capabilities.read.state === "unsupported"} icon={icons.bookOpen}>Read</Button>
                      {e.file.contentPath && e.capabilities.download.state === "supported" && <DownloadLink href={e.file.contentPath}>Download</DownloadLink>}
                    </Row>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Stack>

      <Stack gap="sm">
        <Heading level={2}>Audiobook files</Heading>
        {recordings.length === 0 ? <EmptyState level={3} title="No audio recordings" /> : audio.map((q, i) => {
          const link = recordings[i]!;
          if (q.isPending) return <Busy key={link.id} />;
          if (q.error) return <ErrorBox key={link.id} error={q.error} />;
          const r = q.data;
          return (
            <Card key={r.id}>
              <Stack gap="sm">
                <Row justify="between">
                  <Heading level={3}>{r.title || link.label || "Recording"}</Heading>
                  <Row gap="xs">
                    <StatusPill state={r.readiness} />
                    <Badge tone="audio">{duration(r.durationMs)}</Badge>
                    <Button size="sm" variant="primary" to={`/listen/${r.id}`} icon={icons.headphones}>Listen</Button>
                  </Row>
                </Row>
                {r.narrators.length > 0 && <Text size="sm" tone="dim">Narrated by {r.narrators.join(", ")}</Text>}
                <Table label={`Files in ${r.title || "recording"}`}>
                  <THead><TR><TH num>#</TH><TH>File</TH><TH num>Length</TH><TH num>Size</TH><TH>Actions</TH></TR></THead>
                  <TBody>
                    {r.files.map((f) => (
                      <TR key={f.id}>
                        <TD num>{f.sequence}</TD>
                        <TD>{f.filename}{!f.available && <Badge tone="warning">missing</Badge>}</TD>
                        <TD num>{duration(f.durationMs)}</TD>
                        <TD num>{bytes(f.sizeBytes)}</TD>
                        <TD>{f.available && r.capabilities.download && <DownloadLink href={f.contentPath}>Download</DownloadLink>}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {r.chapters.length > 0 && <Text size="sm" tone="dim">{r.chapters.length} chapters{r.chapters.some((c) => c.generated) ? " (some generated from file boundaries)" : ""}.</Text>}
              </Stack>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
}
