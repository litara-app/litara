import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Alert, Badge, Button, Cover, IconAction, MenuButton, RangeSlider, Row, ScrollRegion, Sheet, Stack, Text, TextLink, icons } from "../ui";
import { Bookmarks } from "./Bookmarks";
import { SLEEP_CHOICES, type SleepChoice } from "./sleep";
import { fmt } from "./timeline";
import type { PlayerController } from "./usePlayerController";

const RATES = [0.75, 1, 1.25, 1.5, 2];

/**
 * The full-screen player, as a Gilt Folio: a two-page spread that floats on the desk like an island, with a bookcloth page
 * for the jacket and imprint and a paper page for playback and the chapter index. Brass corner brackets mark its edges.
 */
export function FullPlayer({ c, open, onMinimize, onClose }: { c: PlayerController; open: boolean; onMinimize: () => void; onClose: () => void }) {
  const r = c.recording;
  const p = c.player;
  const nav = useNavigate();
  const { sync, pend } = c;
  const sv = sync.status;
  const server = sync.conflict?.server.position;
  const here = c.chapters.findIndex((x) => x.id === c.chapter?.id);
  // Keep the current chapter in view inside the list as playback moves on.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "nearest" }); }, [c.chapter?.id, open]);
  return (
    <Sheet open={open} onClose={onMinimize} title={`Now playing: ${r.title}`}>
      <div className="lt-full">
        <Row justify="between">
          <Row gap="xs">
            <IconAction label="Minimize the player" icon={icons.minimize} onClick={onMinimize} />
            <Button size="sm" variant="subtle" icon={icons.book} onClick={() => { onMinimize(); nav(`/titles/${r.titleId}`); }}>Book page</Button>
          </Row>
          <Row gap="xs">
            {sync.finished && <Badge tone="success">Finished</Badge>}
            <Badge tone={sv === "saving" || sv === "offline" ? "neutral" : "success"} data-testid="save-status">
              {sv === "saving" ? "saving" : sv === "offline" ? "waiting to send" : sv === "saved" ? "position saved" : sv === "conflict" ? "paused" : ""}</Badge>
            <IconAction label="Close the player" icon={icons.close} onClick={onClose} />
          </Row>
        </Row>

        <div className="lt-spread lt-island lt-corners">
          <section className="lt-spread-cloth" aria-label="The book">
            <div className="lt-spread-cover"><Cover title={r.title} author={r.authors[0]} titleId={r.titleId} medium="audio" /></div>
            <h2 className="lt-spread-title" data-testid="listen-title">{r.title}</h2>
            <span className="lt-spread-rule" aria-hidden="true" />
            <div className="lt-spread-by"><Text>{r.authors.join(", ")}</Text></div>
            {r.narrators.length > 0 && <div className="lt-spread-by"><Text size="sm">Narrated by {r.narrators.join(", ")}</Text></div>}
          </section>

          <section className="lt-spread-page" aria-label="Playback">
            {pend.offline && pend.items.length > 0 && (
              <Alert tone="warning" role="status" data-testid="offline-banner">The server cannot be reached. Your place is kept on this device and will be sent when the connection returns. <TextLink to="/pending">Details</TextLink></Alert>
            )}
            {!c.ready && <Alert tone="warning" title="This recording cannot be played yet">{r.issues.map((i) => i.message).join(" ") || "It is incomplete."}</Alert>}
            {p.unsupported.length > 0 && <Alert tone="warning" title="Some files may not play in this browser" data-testid="unsupported">This browser reports no support for: {p.unsupported.join(", ")}. Download the originals to play them elsewhere.</Alert>}
            {p.error && <Alert tone="danger" role="alert" data-testid="player-error">{p.error}</Alert>}
            {sync.changed && <Alert tone="warning" role="alert">{sync.changed}</Alert>}
            {sync.conflict && (
              <Alert tone="warning" role="alert" title="Your place changed on another device">
                <Row>
                  <Text as="span" size="sm">{server ? `${server.deviceName || "Another device"} is at ${fmt(c.offsets[r.files.findIndex((f) => f.id === server.fileId)] + server.offsetMs || 0)}.` : "A different place was saved."}</Text>
                  <Button size="sm" variant="primary" onClick={() => void c.adopt("keep_server")} icon={icons.check}>Go to that place</Button>
                  <Button size="sm" onClick={() => void c.adopt("use_candidate")} icon={icons.check}>Keep my place</Button>
                </Row>
              </Alert>
            )}
            {c.candidates.length > 0 && !c.chosen && (
              <Alert tone="info" title="Choose where to continue" data-testid="candidates">
                <Stack gap="sm">
                  <Text size="sm">This recording was reorganized. Your earlier places are offered; none is chosen for you.</Text>
                  <Row wrap>{c.candidates.map((x) => {
                    const fi = r.files.findIndex((f) => f.id === x.candidate!.fileId);
                    return <Button key={x.id} size="sm" onClick={() => void c.useCandidate(x)} icon={icons.chevRight}>
                      {fmt((c.offsets[fi] ?? 0) + x.candidate!.offsetMs)} ({x.candidate!.deviceName || "earlier"})</Button>;
                  })}</Row>
                </Stack>
              </Alert>
            )}

            <div className="lt-spread-deck lt-corners-sm" data-testid="deck">
            <div>
              <div className="lt-spread-kicker"><Text size="xs" tone="dim">{c.chapters.length > 0 ? `Chapter ${Math.max(here, 0) + 1} of ${c.chapters.length}` : "Now playing"}</Text></div>
              <div className="lt-spread-chapter" data-testid="chapter-now">{c.chapter ? c.chapter.label : r.title}</div>
            </div>

            <Stack gap="xs">
              <RangeSlider label="Position in the recording" min={0} max={Math.max(c.total, 1)} value={c.shown} disabled={!c.ready} onChange={c.setScrub} onCommit={c.commitScrub} />
              <Row justify="between">
                <Text as="span" size="sm" mono tone="dim" data-testid="elapsed">{fmt(c.shown)}</Text>
                <Text as="span" size="sm" mono tone="dim" data-testid="total">{fmt(c.total)}</Text>
              </Row>
            </Stack>

            <div className="lt-spread-transport">
              <IconAction label="Previous chapter" icon={icons.skipPrev} disabled={!c.ready || !c.hasChapters} onClick={c.prevChapter} testId="prev-chapter" />
              <IconAction label="Back 30 seconds" icon={icons.back30} disabled={!c.ready} onClick={() => p.skip(-30_000)} />
              <span className="lt-spread-play"><IconAction label={p.playing ? "Pause" : "Play"} icon={p.playing ? icons.pause : icons.play} disabled={!c.ready} onClick={p.toggle} testId="play" /></span>
              <IconAction label="Forward 30 seconds" icon={icons.fwd30} disabled={!c.ready} onClick={() => p.skip(30_000)} />
              <IconAction label="Next chapter" icon={icons.skipNext} disabled={!c.ready || !c.canNext} onClick={c.nextChapter} testId="next-chapter" />
            </div>
            {p.buffering && <Text size="xs" tone="dim">Buffering…</Text>}

            <Row justify="center" gap="sm" wrap>
              <MenuButton label={`${p.rate}×`} icon={icons.speed} entries={RATES.map((x) => ({ value: String(x), label: `${x}×` }))} onAction={(v) => p.setRate(Number(v))} />
              <MenuButton label={c.sleep.left !== null ? fmt(c.sleep.left) : "Sleep"} icon={icons.moon}
                entries={SLEEP_CHOICES.map((x) => ({ value: x.value, label: x.value === c.sleep.choice ? `${x.label} (on)` : x.label }))} onAction={(v) => c.sleep.set(v as SleepChoice)} />
              <MenuButton label="Recording actions" iconOnly icon={icons.dots} entries={[{ value: "finish", label: sync.finished ? "Mark unfinished" : "Mark finished" }]}
                onAction={() => sync.writeCompletion(sync.finished ? "manual_unfinish" : "manual_finish", null)} />
            </Row>
            </div>

            {c.chapters.length > 0 && (
              <section className="lt-spread-chapters lt-corners-sm" aria-label="Chapters">
                <Row justify="between">
                  <h3 className="lt-spread-chapters-title">Chapters</h3>
                  <Text as="span" size="xs" tone="dim">{c.chapters.length} {c.chapters.length === 1 ? "chapter" : "chapters"}</Text>
                </Row>
                <ScrollRegion label="Chapter list">
                  <div className="lt-spread-chapter-list" ref={list}>
                    {c.chapters.map((x) => (
                      <Button key={x.id} block icon={x.id === c.chapter?.id ? icons.headphones : icons.bookmark} variant={c.chapter?.id === x.id ? "primary" : "subtle"} data-testid="chapter"
                        data-current={x.id === c.chapter?.id ? "true" : undefined} disabled={!c.ready} onClick={() => p.seekWhole(x.at)}>
                        <span>{x.label}{x.generated ? " (file boundary)" : ""}</span><span className="lt-leader" /><span className="lt-mono">{fmt(x.at)}</span>
                      </Button>
                    ))}
                  </div>
                </ScrollRegion>
              </section>
            )}
            {open && <Bookmarks c={c} />}
          </section>
        </div>
      </div>
    </Sheet>
  );
}
