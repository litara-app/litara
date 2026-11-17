import { Alert, Badge, Button, Card, Group, Image, Select, Slider, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api, get } from "../api/client";
import type { AudioPositionState, AudioRecording } from "../api/types";
import { usePendingState } from "../pending/PendingProvider";
import { SendFile } from "../settings/SendFile";
import { Busy, ErrorBox } from "../ui/common";
import { fmt, startOffsets, totalMs } from "./timeline";
import { useAudioPlayer } from "./useAudioPlayer";
import { useRecordingSync } from "./useRecordingSync";

export function ListenPage() {
  const { recordingId = "" } = useParams();
  const rec = useQuery({ queryKey: ["listen", recordingId], queryFn: () => get<AudioRecording>(`/recordings/${recordingId}`), staleTime: Infinity, gcTime: 0 });
  const pos = useQuery({ queryKey: ["listen-pos", recordingId], queryFn: () => get<AudioPositionState>(`/recordings/${recordingId}/position`), staleTime: Infinity, gcTime: 0 });
  if (rec.isPending || pos.isPending) return <Busy />;
  const err = rec.error ?? pos.error;
  if (err) return <Stack p="md"><ErrorBox error={err} /><Button component={Link} to="/" variant="default">Back to library</Button></Stack>;
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
    <Stack p="md" maw={720} mx="auto" gap="sm">
      <Group justify="space-between">
        <Button component={Link} to={`/titles/${r.titleId}`} variant="default" size="compact-sm">Back</Button>
        <Group gap="xs">
          {sync.finished && <Badge color="green">Finished</Badge>}
          <Badge size="sm" variant="light" color={sv === "saving" || sv === "offline" ? "gray" : "green"} data-testid="save-status">
            {sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
        </Group>
      </Group>

      <Group wrap="nowrap" align="flex-start">
        {r.artwork.coverPath && <Image src={r.artwork.coverPath} w={96} h={96} radius="sm" alt="Cover" fit="cover" />}
        <Stack gap={2}>
          <Title order={2} data-testid="listen-title">{r.title}</Title>
          <Text c="dimmed">{r.authors.join(", ")}</Text>
          {r.narrators.length > 0 && <Text size="sm" c="dimmed">Narrated by {r.narrators.join(", ")}</Text>}
        </Stack>
      </Group>

      {pend.offline && pend.items.length > 0 && (
        <Alert color="yellow" role="status" data-testid="offline-banner">The server cannot be reached. Your place is kept on this device and will be sent when the connection returns. <Link to="/pending">Details</Link></Alert>
      )}
      {!ready && <Alert color="yellow" title="This recording cannot be played yet">{r.issues.map((i) => i.message).join(" ") || "It is incomplete."}</Alert>}
      {player.unsupported.length > 0 && <Alert color="orange" title="Some files may not play in this browser" data-testid="unsupported">This browser reports no support for: {player.unsupported.join(", ")}. Download the originals to play them elsewhere.</Alert>}
      {player.error && <Alert color="red" role="alert" data-testid="player-error">{player.error}</Alert>}
      {sync.changed && <Alert color="orange" role="alert">{sync.changed}</Alert>}
      {sync.conflict && (
        <Alert color="orange" role="alert" title="Your place changed on another device">
          <Group gap="xs">
            <Text size="sm">{server ? `${server.deviceName || "Another device"} is at ${fmt(offsets[r.files.findIndex((f) => f.id === server.fileId)] + server.offsetMs || 0)}.` : "A different place was saved."}</Text>
            <Button size="compact-xs" onClick={() => void adopt("keep_server")}>Go to that place</Button>
            <Button size="compact-xs" variant="default" onClick={() => void adopt("use_candidate")}>Keep my place</Button>
          </Group>
        </Alert>
      )}
      {candidates.length > 0 && !chosen && (
        <Alert color="blue" title="Choose where to continue" data-testid="candidates">
          <Text size="sm" mb="xs">This recording was reorganized. Your earlier places are offered; none is chosen for you.</Text>
          <Group gap="xs">{candidates.map((c) => {
            const fi = r.files.findIndex((f) => f.id === c.candidate!.fileId);
            return <Button key={c.id} size="compact-sm" variant="default" onClick={() => void useCandidate(c)}>
              {fmt((offsets[fi] ?? 0) + c.candidate!.offsetMs)} ({c.candidate!.deviceName || "earlier"})</Button>;
          })}</Group>
        </Alert>
      )}
      <ErrorBox error={resolveError} />

      <Card withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text ff="monospace" data-testid="elapsed">{fmt(shown)}</Text>
            <Text ff="monospace" c="dimmed" data-testid="total">{fmt(total)}</Text>
          </Group>
          <Slider min={0} max={Math.max(total, 1)} value={shown} label={(v) => fmt(v)} disabled={!ready} aria-label="Position in the recording" thumbLabel="Position in the recording"
            onChange={setScrub} onChangeEnd={(v) => { setScrub(null); player.seekWhole(v); }} />
          <Group justify="center" gap="md">
            <Button variant="default" disabled={!ready} onClick={() => player.skip(-30_000)} aria-label="Back 30 seconds">−30s</Button>
            <Button size="lg" disabled={!ready} onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"} data-testid="play">
              {player.playing ? "Pause" : "Play"}</Button>
            <Button variant="default" disabled={!ready} onClick={() => player.skip(30_000)} aria-label="Forward 30 seconds">+30s</Button>
          </Group>
          <Group justify="space-between">
            <Select size="xs" w={110} label="Speed" allowDeselect={false} value={String(player.rate)} onChange={(v) => player.setRate(Number(v))} data={RATES.map((x) => ({ value: x, label: `${x}×` }))} />
            <Button size="compact-sm" variant="default" onClick={() => sync.writeCompletion(sync.finished ? "manual_unfinish" : "manual_finish", null)}>
              {sync.finished ? "Mark unfinished" : "Mark finished"}</Button>
          </Group>
          {player.buffering && <Text size="xs" c="dimmed">Buffering…</Text>}
        </Stack>
      </Card>

      {chapters.length > 0 && (
        <Stack gap={4}>
          <Title order={4}>Chapters</Title>
          {chapters.map((c) => (
            <Button key={c.id} variant={currentChapter?.id === c.id ? "light" : "subtle"} justify="space-between" fullWidth data-testid="chapter" disabled={!ready}
              rightSection={<Text size="xs" ff="monospace">{fmt(c.at)}</Text>} onClick={() => player.seekWhole(c.at)}>
              {c.label}{c.generated ? " (file boundary)" : ""}
            </Button>
          ))}
        </Stack>
      )}
      <SendAudioFile recording={r} />
    </Stack>
  );
}

/** Email one original audio file. Each file is its own request; there is no whole-recording package. */
export function SendAudioFile({ recording: r }: { recording: AudioRecording }) {
  const [fileId, setFileId] = useState<string | null>(null);
  const file = r.files.find((f) => f.id === fileId);
  const files = r.files.filter((f) => f.available);
  if (files.length === 0) return null;
  return (
    <Stack gap="xs" data-testid="audio-send">
      <Title order={4}>Email an original file</Title>
      <Select label="File" placeholder="Choose one file" value={fileId} onChange={setFileId} description="Each file is sent separately and unchanged."
        data={files.map((f) => ({ value: f.id, label: `File ${f.sequence + 1} of ${r.files.length}: ${f.filename}` }))} />
      {file && <SendFile key={file.id + file.contentVersion} target={{ fileId: file.id, contentVersion: file.contentVersion, sizeBytes: file.sizeBytes, label: file.filename }} />}
    </Stack>
  );
}
