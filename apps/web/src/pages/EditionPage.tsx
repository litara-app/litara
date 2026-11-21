import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api, get } from "../api/client";
import type { Edition } from "../api/types";
import { EditionAdmin } from "../admin/EditionAdmin";
import { useAuth } from "../auth/session";
import { KoEditionCard } from "../settings/KoEditionCard";
import { SendFile } from "../settings/SendFile";
import { icons, Alert, Badge, Busy, bytes, Button, CapBadge, Card, DownloadLink, ErrorBox, FormatTag, Heading, Page, PageHeader, Row, Stack, StatusPill } from "../ui";

export function EditionPage() {
  const { editionId = "" } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["edition", editionId], queryFn: () => get<Edition>(`/editions/${editionId}`) });
  const finish = useMutation({
    mutationFn: (e: Edition) =>
      api("PUT", `/editions/${e.id}/completion`, {
        operationId: crypto.randomUUID(), baseRevision: e.completion.revision, capturedAt: new Date().toISOString(),
        fileId: e.file.id, contentVersion: e.file.contentVersion, event: e.completion.finished ? "manual_unfinish" : "manual_finish",
      }),
    // A stale revision or changed file produces a 409/412: refetch and show the server state.
    onSettled: () => qc.invalidateQueries({ queryKey: ["edition", editionId] }),
  });

  if (q.isPending) return <Busy />;
  if (q.error) return <Page><ErrorBox error={q.error} /></Page>;
  const e = q.data;
  const caps = e.capabilities;
  const damage = caps.read.issues.find((i) => i.code === "file_damaged");
  const readable = !damage && ["epub", "kepub", "fb2", "pdf", "cbz", "cbr", "cb7", "mobi", "azw", "azw3"].includes(e.file.format) && caps.read.state !== "unsupported" && e.file.availability === "available" && !!e.file.contentPath;
  return (
    <Page>
      <div><Button variant="subtle" size="sm" to={`/titles/${e.titleId}`} icon={icons.arrowLeft}>Back to title</Button></div>
      <PageHeader title={e.label || e.file.format.toUpperCase()}
        actions={
          <>
            {readable ? <Button variant="primary" to={`/read/${e.id}`} icon={icons.bookOpen}>Read</Button>
              : <Button disabled title={damage?.detail ?? "The web reader does not support this format yet"} icon={icons.bookOpen}>Read</Button>}
            {e.file.contentPath && caps.download.state === "supported" && (
              <DownloadLink href={e.file.contentPath}>Download original</DownloadLink>
            )}
            <Button loading={finish.isPending} onClick={() => finish.mutate(e)} icon={icons.check}>
              {e.completion.finished ? "Mark unfinished" : "Mark finished"}
            </Button>
          </>
        } />
      <Row gap="xs">
        <FormatTag format={e.file.format} />
        <Badge tone="neutral">{bytes(e.file.sizeBytes)}</Badge>
        <StatusPill state={e.readiness} />
        {e.completion.finished && <StatusPill state="finished" />}
      </Row>
      {e.issues.map((i) => <Alert key={i.code} tone="warning" title={i.code === "file_damaged" ? "Damaged file" : i.code}>{i.detail}</Alert>)}
      <ErrorBox error={finish.error} />

      <Card>
        <Stack gap="sm">
          <Heading level={2}>Capabilities</Heading>
          <Row gap="xs" wrap>
            {(Object.keys(caps) as (keyof typeof caps)[]).map((k) => <CapBadge key={k} name={k} cap={caps[k]} />)}
          </Row>
        </Stack>
      </Card>

      {e.file.availability === "available" && <SendFile target={{ fileId: e.file.id, contentVersion: e.file.contentVersion, sizeBytes: e.file.sizeBytes, label: e.label || e.file.format.toUpperCase() }} />}
      <KoEditionCard editionId={e.id} fileId={e.file.id} contentVersion={e.file.contentVersion} />
      {user?.isAdmin && <EditionAdmin edition={e} />}
    </Page>
  );
}
