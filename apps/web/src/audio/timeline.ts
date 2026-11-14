// Whole-recording time over an ordered list of files. Positions are always
// stored as file + content version + millisecond offset; the whole-recording
// time exists only for display and seeking (ADR-0029).

export interface TimedFile { id: string; durationMs: number }

export function startOffsets(files: TimedFile[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const f of files) { out.push(sum); sum += f.durationMs; }
  return out;
}

export const totalMs = (files: TimedFile[]) => files.reduce((s, f) => s + f.durationMs, 0);

/** The file holding a whole-recording time, clamped into the recording. */
export function locate(files: TimedFile[], wholeMs: number): { index: number; offsetMs: number } {
  const offs = startOffsets(files);
  const t = Math.max(0, Math.min(wholeMs, Math.max(0, totalMs(files) - 1)));
  for (let i = files.length - 1; i >= 0; i--) if (t >= offs[i]) return { index: i, offsetMs: Math.min(t - offs[i], files[i].durationMs) };
  return { index: 0, offsetMs: 0 };
}

export function toWhole(files: TimedFile[], index: number, offsetMs: number): number {
  return startOffsets(files)[index] + Math.max(0, Math.min(offsetMs, files[index].durationMs));
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
