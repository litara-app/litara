import { Badge, Cover, IconAction, RangeSlider, Text, icons } from "../ui";
import { fmt } from "./timeline";
import type { PlayerController } from "./usePlayerController";

/**
 * The minimized player: a leather-bound island under the page, with brass corner brackets, so the rest of the app stays in
 * view above it.
 */
export function MiniPlayer({ c, onExpand, onClose }: { c: PlayerController; onExpand: () => void; onClose: () => void }) {
  const r = c.recording;
  const p = c.player;
  return (
    <aside className="lt-mini lt-corners-sm" aria-label="Audio player" data-testid="mini-player">
      <span className="lt-mini-cover"><Cover tiny title={r.title} author={r.authors[0]} titleId={r.titleId} medium="audio" /></span>
      <div className="lt-mini-text">
        <Text strong data-testid="mini-title">{r.title}</Text>
        <Text size="xs" tone="dim">{c.chapter ? c.chapter.label : r.authors.join(", ")}</Text>
      </div>
      <div className="lt-mini-controls">
        <IconAction label="Previous chapter" icon={icons.skipPrev} disabled={!c.ready || !c.hasChapters} onClick={c.prevChapter} />
        <IconAction label="Back 30 seconds" icon={icons.back30} disabled={!c.ready} onClick={() => p.skip(-30_000)} />
        <span className="lt-mini-play"><IconAction label={p.playing ? "Pause" : "Play"} icon={p.playing ? icons.pause : icons.play} disabled={!c.ready} onClick={p.toggle} /></span>
        <IconAction label="Forward 30 seconds" icon={icons.fwd30} disabled={!c.ready} onClick={() => p.skip(30_000)} />
        <IconAction label="Next chapter" icon={icons.skipNext} disabled={!c.ready || !c.canNext} onClick={c.nextChapter} />
      </div>
      <div className="lt-mini-seek">
        <Text as="span" size="xs" mono tone="dim" data-testid="mini-elapsed">{fmt(c.shown)}</Text>
        <RangeSlider label="Position in the recording" min={0} max={Math.max(c.total, 1)} value={c.shown} disabled={!c.ready} onChange={c.setScrub} onCommit={c.commitScrub} />
        <Text as="span" size="xs" mono tone="dim">{fmt(c.total)}</Text>
      </div>
      {c.sleep.left !== null && <Badge tone="audio" data-testid="mini-sleep">Sleep {fmt(c.sleep.left)}</Badge>}
      {c.attention && <Badge tone="warning" data-testid="mini-attention">Needs attention</Badge>}
      <div className="lt-mini-end">
        <IconAction label="Open the full player" icon={icons.maximize} onClick={onExpand} />
        <IconAction label="Close the player" icon={icons.close} onClick={onClose} />
      </div>
    </aside>
  );
}
