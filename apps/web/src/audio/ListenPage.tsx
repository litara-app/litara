import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { api, get } from "../api/client";
import type { AudioPositionState, AudioRecording } from "../api/types";
import { usePendingState } from "../pending/PendingProvider";
import { SendFile } from "../settings/SendFile";
import { icons, Alert, Badge, Busy, Button, Card, ErrorBox, Heading, Page, RangeSlider, Row, SelectField, Stack, Text, TextLink } from "../ui";
import { fmt, startOffsets, totalMs } from "./timeline";
import { useAudioPlayer } from "./useAudioPlayer";
import { useRecordingSync } from "./useRecordingSync";

export function ListenPage() {
  const { recordingId = "" } = useParams();
  const rec = useQuery({ queryKey: ["listen", recordingId], queryFn: () => get<AudioRecording>(`/recordings/${recordingId}`), staleTime: Infinity, gcTime: 0 });
  const pos = useQuery({ queryKey: ["listen-pos", recordingId], queryFn: () => get<AudioPositionState>(`/recordings/${recordingId}/position`), staleTime: Infinity, gcTime: 0 });
  if (rec.isPending || pos.isPending) return <Busy />;
  const err = rec.error ?? pos.error;
  if (err) return <Page><ErrorBox error={err} /><Row><Button to="/" icon={icons.arrowLeft}>Back to library</Button></Row></Page>;
  return <Player recording={rec.data!} initial={pos.data!} />;
}

const RATES = ["0.75", "1", "1.25", "1.5", "2"];

function Player({ recording: r, initial }: { recording: AudioRecording; initial: AudioPositionState }) {
  const sync = useRecordingSync(r, initial.revision);
  const pend = usePendingState();
  const ready = r.readiness === "ready" && r.capabilities.play && r.files.every((f) => f.durationMs);
  const player = useAudioPlayer({
    recording: r,
    onCheckpoint: sync.savePosition,
    onEnded: (final) => sync.writeCompletion("natural_end", final),
  });
  const timed = useMemo(() => r.files.map((f) => ({ id: f.id, durationMs: f.durationMs ?? 0 })), [r.files]);
  const total = totalMs(timed);
  const offsets = useMemo(() => startOffsets(timed), [timed]);
  const [scrub, setScrub] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<unknown>(null);

  // Resume at the saved place only when it still belongs to this exact layout; otherwise start at the beginning.
  const saved = initial.position;
  useEffect(() => {
    if (saved && saved.layoutRevision === r.layoutRevision) player.restore(saved.fileId, saved.contentVersion, saved.offsetMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  // Explicit candidates (for example after a recording repair) are offered, never applied.
  const candidates = !saved ? initial.unresolvedConflicts.filter((c) => c.candidate) : [];
  const [chosen, setChosen] = useState(false);

  const chapters = r.chapters.map((c) => {
    const fi = r.files.findIndex((f) => f.id === c.start.fileId && f.contentVersion === c.start.contentVersion);
    const at = c.recordingStartMs ?? (fi >= 0 ? offsets[fi] + c.start.offsetMs : 0);
    return { ...c, at };
  }).sort((a, b) => a.at - b.at);
  const currentChapter = [...chapters].reverse().find((c) => c.at <= player.whole);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: r.title, artist: r.authors.join(", "), album: r.narrators.length ? `Narrated by ${r.narrators.join(", ")}` : "",
      artwork: r.artwork.coverPath ? [{ src: r.artwork.coverPath }] : [] });
    ms.setActionHandler("play", () => void player.play());
    ms.setActionHandler("pause", () => player.pause());
    ms.setActionHandler("seekbackward", () => player.skip(-30_000));
    ms.setActionHandler("seekforward", () => player.skip(30_000));
    return () => { for (const a of ["play", "pause", "seekbackward", "seekforward"] as const) ms.setActionHandler(a, null); };
  });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;
      if (e.code === "Space") { e.preventDefault(); player.toggle(); }
      if (e.code === "ArrowLeft") player.skip(-10_000);
      if (e.code === "ArrowRight") player.skip(10_000);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const shown = scrub ?? player.whole;
  const sv = sync.status;
  const server = sync.conflict?.server.position;

  async function adopt(choice: "keep_server" | "use_candidate") {
    try {
      setResolveError(null);
      const res = await sync.resolve(choice, sync.conflict!.conflictId, sync.conflict!.server.revision);
      if (choice === "keep_server" && res.position && res.position.layoutRevision === r.layoutRevision) player.restore(res.position.fileId, res.position.contentVersion, res.position.offsetMs);
    } catch (e) { setResolveError(e); }
  }

  async function useCandidate(c: AudioPositionState["unresolvedConflicts"][number]) {
    try {
      setResolveError(null);
      const res = await api<AudioPositionState>("POST", `/recordings/${r.id}/conflicts/${c.id}/resolve`, {
        operationId: crypto.randomUUID(), baseRevision: initial.revision, layoutRevision: r.layoutRevision, choice: "use_candidate", position: null });
      sync.setRevision(res.revision);
      if (res.position) player.restore(res.position.fileId, res.position.contentVersion, res.position.offsetMs);
      setChosen(true);
    } catch (e) { setResolveError(e); }
  }

  return (
    <Page narrow>
      <Row justify="between">
        <Button size="sm" to={`/titles/${r.titleId}`} icon={icons.arrowLeft}>Back</Button>
        <Row gap="xs">
          {sync.finished && <Badge tone="success">Finished</Badge>}
          <Badge tone={sv === "saving" || sv === "offline" ? "neutral" : "success"} data-testid="save-status">
            {sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
        </Row>
      </Row>

      <Row align="start" gap="lg">
        {r.artwork.coverPath && <img className="lt-listen-cover" src={r.artwork.coverPath} alt="Cover" />}
        <Stack gap="xs">
          <Heading level={1} serif data-testid="listen-title">{r.title}</Heading>
          <Text tone="dim">{r.authors.join(", ")}</Text>
          {r.narrators.length > 0 && <Text size="sm" tone="dim">Narrated by {r.narrators.join(", ")}</Text>}
        </Stack>
      </Row>

      {pend.offline && pend.items.length > 0 && (
        <Alert tone="warning" role="status" data-testid="offline-banner">The server cannot be reached. Your place is kept on this device and will be sent when the connection returns. <TextLink to="/pending">Details</TextLink></Alert>
      )}
      {!ready && <Alert tone="warning" title="This recording cannot be played yet">{r.issues.map((i) => i.message).join(" ") || "It is incomplete."}</Alert>}
      {player.unsupported.length > 0 && <Alert tone="warning" title="Some files may not play in this browser" data-testid="unsupported">This browser reports no support for: {player.unsupported.join(", ")}. Download the originals to play them elsewhere.</Alert>}
      {player.error && <Alert tone="danger" role="alert" data-testid="player-error">{player.error}</Alert>}
      {sync.changed && <Alert tone="warning" role="alert">{sync.changed}</Alert>}
      {sync.conflict && (
        <Alert tone="warning" role="alert" title="Your place changed on another device">
          <Row>
            <Text as="span" size="sm">{server ? `${server.deviceName || "Another device"} is at ${fmt(offsets[r.files.findIndex((f) => f.id === server.fileId)] + server.offsetMs || 0)}.` : "A different place was saved."}</Text>
            <Button size="sm" variant="primary" onClick={() => void adopt("keep_server")} icon={icons.check}>Go to that place</Button>
            <Button size="sm" onClick={() => void adopt("use_candidate")} icon={icons.check}>Keep my place</Button>
          </Row>
        </Alert>
      )}
      {candidates.length > 0 && !chosen && (
        <Alert tone="info" title="Choose where to continue" data-testid="candidates">
          <Stack gap="sm">
            <Text size="sm">This recording was reorganized. Your earlier places are offered; none is chosen for you.</Text>
            <Row wrap>{candidates.map((c) => {
              const fi = r.files.findIndex((f) => f.id === c.candidate!.fileId);
              return <Button key={c.id} size="sm" onClick={() => void useCandidate(c)} icon={icons.chevRight}>
                {fmt((offsets[fi] ?? 0) + c.candidate!.offsetMs)} ({c.candidate!.deviceName || "earlier"})</Button>;
            })}</Row>
          </Stack>
        </Alert>
      )}
      <ErrorBox error={resolveError} />

      <Card>
        <Stack gap="md">
          <Row justify="between">
            <Text as="span" mono data-testid="elapsed">{fmt(shown)}</Text>
            <Text as="span" mono tone="dim" data-testid="total">{fmt(total)}</Text>
          </Row>
          <RangeSlider label="Position in the recording" min={0} max={Math.max(total, 1)} value={shown} disabled={!ready}
            onChange={setScrub} onCommit={(v) => { setScrub(null); player.seekWhole(v); }} />
          <Row justify="center" gap="md">
            <Button disabled={!ready} onClick={() => player.skip(-30_000)} aria-label="Back 30 seconds">−30s</Button>
            <Button variant="primary" disabled={!ready} onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"} icon={player.playing ? icons.pause : icons.play} data-testid="play">
              {player.playing ? "Pause" : "Play"}</Button>
            <Button disabled={!ready} onClick={() => player.skip(30_000)} aria-label="Forward 30 seconds">+30s</Button>
          </Row>
          <Row justify="between" align="end">
            <SelectField label="Speed" value={String(player.rate)} onValue={(v) => v && player.setRate(Number(v))} items={RATES.map((x) => ({ value: x, label: `${x}×` }))} />
            <Button size="sm" onClick={() => sync.writeCompletion(sync.finished ? "manual_unfinish" : "manual_finish", null)} icon={icons.check}>
              {sync.finished ? "Mark unfinished" : "Mark finished"}</Button>
          </Row>
          {player.buffering && <Text size="xs" tone="dim">Buffering…</Text>}
        </Stack>
      </Card>

      {chapters.length > 0 && (
        <Stack gap="xs">
          <Heading level={2}>Chapters</Heading>
          {chapters.map((c) => (
            <Button key={c.id} block variant={currentChapter?.id === c.id ? "primary" : "subtle"} data-testid="chapter" disabled={!ready} onClick={() => player.seekWhole(c.at)}>
              <span>{c.label}{c.generated ? " (file boundary)" : ""}</span><span className="lt-leader" /><span className="lt-mono">{fmt(c.at)}</span>
            </Button>
          ))}
        </Stack>
      )}
      <SendAudioFile recording={r} />
    </Page>
  );
}

/** Email one original audio file. Each file is its own request; there is no whole-recording package. */
export function SendAudioFile({ recording: r }: { recording: AudioRecording }) {
  const [fileId, setFileId] = useState<string | null>(null);
  const file = r.files.find((f) => f.id === fileId);
  const files = r.files.filter((f) => f.available);
  if (files.length === 0) return null;
  return (
    <Stack gap="sm" data-testid="audio-send">
      <Heading level={2}>Email an original file</Heading>
      <SelectField label="File" placeholder="Choose one file" value={fileId} onValue={setFileId} description="Each file is sent separately and unchanged."
        items={files.map((f) => ({ value: f.id, label: `File ${f.sequence + 1} of ${r.files.length}: ${f.filename}` }))} />
      {file && <SendFile key={file.id + file.contentVersion} target={{ fileId: file.id, contentVersion: file.contentVersion, sizeBytes: file.sizeBytes, label: file.filename }} />}
    </Stack>
  );
}
