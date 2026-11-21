import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { get } from "../api/client";
import type { AudioRecording, Edition, Page as Paged, RecordingLink, TitleDetail } from "../api/types";
import { usePlayer } from "../audio/PlayerProvider";
import { SendFile } from "../settings/SendFile";
import { useAuth } from "../auth/session";
import {
  BookCover, Busy, Button, ErrorBox, StarRating, formatLabel, Heading, IconAction, icons, MenuButton, Modal, Page, Row, StatusPill, TabBar, TabFrame, TabPane, Text, Badge,
} from "../ui";
import { DetailsTab } from "./title/DetailsTab";
import { FilesTab } from "./title/FilesTab";
import { HighlightsTab } from "./title/HighlightsTab";
import { MetadataTab } from "./title/MetadataTab";
import { ReadingLogTab } from "./title/ReadingLogTab";
import { usePersonal } from "./title/usePersonal";
import { isReadable } from "./useTitleActions";
import { useShelfActions } from "./useShelves";

const TABS = ["details", "metadata", "files", "log", "highlights"];

export function TitlePage() {
  const { titleId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const player = usePlayer();
  const shelf = useShelfActions();
  const personal = usePersonal(titleId);
  const [sending, setSending] = useState(false);
  const detail = useQuery({ queryKey: ["title", titleId], queryFn: () => get<TitleDetail>(`/titles/${titleId}`) });
  const editions = useQuery({ queryKey: ["title", titleId, "editions"], queryFn: () => get<Paged<Edition>>(`/editions?titleId=${titleId}&size=200`) });
  const recordings = useQuery({ queryKey: ["title", titleId, "recordings"], queryFn: () => get<Paged<RecordingLink>>(`/titles/${titleId}/recordings?size=200`) });
  const eds = editions.data?.items ?? [];
  const recs = recordings.data?.items ?? [];
  const audio = useQuery({
    queryKey: ["recording", recs[0]?.id], enabled: !!recs[0],
    queryFn: () => get<AudioRecording>(`/recordings/${recs[0]!.id}`),
  });

  const asked = params.get("tab") ?? "details";
  const tab = TABS.includes(asked) && (asked !== "metadata" || user?.isAdmin) ? asked : "details";
  const setTab = (v: string) => { const n = new URLSearchParams(params); if (v === "details") n.delete("tab"); else n.set("tab", v); setParams(n, { replace: true }); };

  if (detail.isPending) return <Busy />;
  if (detail.error) return <Page><ErrorBox error={detail.error} /></Page>;
  const t = detail.data.title;
  const readable = eds.find(isReadable);
  const downloadable = eds.filter((e) => e.file.contentPath && e.capabilities.download.state === "supported");
  const finished = eds.length > 0 && eds.every((e) => e.completion.finished);
  const audioExts = [...new Set((audio.data?.files ?? []).map((f) => f.filename.split(".").pop()?.toUpperCase() ?? ""))].filter(Boolean);
  const sendable = eds.find((e) => e.file.availability === "available");

  const tabs = [
    { value: "details", label: "Details", icon: icons.info },
    ...(user?.isAdmin ? [{ value: "metadata", label: "Edit metadata", icon: icons.pencil }] : []),
    { value: "files", label: "Files", icon: icons.files },
    { value: "log", label: "Reading log", icon: icons.clock },
    { value: "highlights", label: "Highlights", icon: icons.highlight },
  ];

  return (
    <Page>
      <TabFrame value={tab} onValueChange={setTab}>
        <div className="lt-folio">
          <div className="lt-folio-bar">
            <Button variant="subtle" size="sm" to="/" icon={icons.arrowLeft}>Library</Button>
            <TabBar label="Title sections" tabs={tabs} />
          </div>
          <div className="lt-folio-body">
            <aside className="lt-folio-side" aria-label="Cover and actions">
              <BookCover title={t.title || "(untitled)"} author={t.authors[0]} titleId={t.id} medium={t.editionCount > 0 ? "ebook" : "audio"} editTo={user?.isAdmin ? `/titles/${t.id}?tab=metadata` : undefined} ebook={formatLabel(eds.map((e) => e.file.format))}
                audio={audioExts.length > 0 ? (audioExts.length > 1 ? `${audioExts[0]} +` : audioExts[0]) : recs.length > 0 ? "AUDIO" : null} />
              {readable
                ? <Button variant="primary" block to={`/read/${readable.id}`} icon={icons.bookOpen}>Read</Button>
                : <Button block disabled icon={icons.bookOpen} title="No readable ebook">Read</Button>}
              <div className="lt-rail">
                {recs[0] ? <IconAction label="Listen" icon={icons.headphones} onClick={() => player.start(recs[0]!.id)} /> : <IconAction label="Listen (no audiobook)" icon={icons.headphones} disabled />}
                {downloadable.length === 1
                  ? <IconAction label="Download" icon={icons.download} href={downloadable[0]!.file.contentPath!} />
                  : <IconAction label={downloadable.length > 1 ? "Download (choose a file)" : "Download (no file)"} icon={icons.download} disabled={downloadable.length === 0} onClick={() => setTab("files")} />}
                <MenuButton label="Add to shelf" iconOnly icon={icons.shelf} variant="default"
                  entries={shelf.shelves.length > 0 ? shelf.shelves.map((s) => ({ value: s.id, label: s.data!.name })) : [{ value: "", label: "No shelves yet", disabled: true }]}
                  onAction={(id) => { const s = shelf.shelves.find((x) => x.id === id); if (s) shelf.add(s, titleId); }} />
                <IconAction label="Send to device" icon={icons.send} disabled={!sendable} onClick={() => setSending(true)} />
              </div>
              <ErrorBox error={shelf.error} />
            </aside>

            <div className="lt-folio-main">
              <header className="lt-folio-head">
                <Heading level={1} serif>{t.title || "(untitled)"}</Heading>
                <Text tone="dim" size="lg">{t.authors.length > 0 ? `by ${t.authors.join(", ")}` : "Unknown author"}{t.series.length > 0 ? ` · ${t.series.join(", ")}` : ""}</Text>
                <Row gap="sm" wrap>
                  <StarRating label="Your rating" value={personal.data?.data.ratingHalves ?? null} disabled={!personal.ready || personal.save.isPending}
                    onValue={(v) => personal.save.mutate({ ratingHalves: v })} />
                  {personal.data?.data.ratingHalves != null && <Text as="span" size="sm" tone="dim">{personal.data.data.ratingHalves / 2} of 5</Text>}
                </Row>
                <ErrorBox error={personal.save.error} />
                <Row gap="xs" wrap>
                  {finished && <StatusPill state="finished" />}
                  {eds.some((e) => e.readiness !== "ready") && <StatusPill state="incomplete" />}
                  {t.languages.map((l) => <Badge key={l} outline tone="neutral">{l}</Badge>)}
                </Row>
              </header>
              <ErrorBox error={editions.error ?? recordings.error} />
              <TabPane value="details"><DetailsTab detail={detail.data} editions={eds} recordings={recs} onTab={setTab} /></TabPane>
              {user?.isAdmin && <TabPane value="metadata"><MetadataTab title={t} editions={eds} recordings={recs} /></TabPane>}
              <TabPane value="files"><FilesTab editions={eds} recordings={recs} /></TabPane>
              <TabPane value="log"><ReadingLogTab titleId={titleId} editions={eds} recordings={recs} /></TabPane>
              <TabPane value="highlights"><HighlightsTab editions={eds} /></TabPane>
            </div>
          </div>
        </div>
      </TabFrame>

      <Modal open={sending} onClose={() => setSending(false)} title="Send to a device" description="Sends the original file to one saved recipient.">
        {sendable && <SendFile target={{ fileId: sendable.file.id, contentVersion: sendable.file.contentVersion, sizeBytes: sendable.file.sizeBytes, label: sendable.label || sendable.file.format.toUpperCase() }} />}
      </Modal>
    </Page>
  );
}
