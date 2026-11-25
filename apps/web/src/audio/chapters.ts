import type { AudioRecording } from "../api/types";

export interface Chapter { id: string; label: string; generated?: boolean; at: number }

/** Chapters in whole-recording time, ordered by start. `offsets` are the start offsets of the recording's files. */
export function chaptersOf(r: AudioRecording, offsets: number[]): Chapter[] {
  return r.chapters.map((c) => {
    const fi = r.files.findIndex((f) => f.id === c.start.fileId && f.contentVersion === c.start.contentVersion);
    const at = c.recordingStartMs ?? (fi >= 0 ? (offsets[fi] ?? 0) + c.start.offsetMs : 0);
    return { id: c.id, label: c.label, generated: c.generated, at };
  }).sort((a, b) => a.at - b.at);
}

export function currentChapter(chapters: Chapter[], whole: number): Chapter | undefined {
  return [...chapters].reverse().find((c) => c.at <= whole);
}

/** Within this long of a chapter's start, "previous" goes to the chapter before it; after it, "previous" restarts the chapter. */
export const RESTART_WINDOW_MS = 3000;

/** Where "previous chapter" goes, or null when there are no chapters. */
export function previousTarget(chapters: Chapter[], whole: number): number | null {
  if (chapters.length === 0) return null;
  const cur = currentChapter(chapters, whole);
  if (!cur) return 0;
  if (whole - cur.at > RESTART_WINDOW_MS) return cur.at;
  const i = chapters.indexOf(cur);
  return i > 0 ? chapters[i - 1]!.at : 0;
}

/** Where "next chapter" goes, or null when there is no later chapter. */
export function nextTarget(chapters: Chapter[], whole: number): number | null {
  return chapters.find((c) => c.at > whole + 250)?.at ?? null;
}
