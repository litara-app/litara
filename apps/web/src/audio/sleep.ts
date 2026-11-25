import type { Chapter } from "./chapters";
import { nextTarget } from "./chapters";

/** What a listener can ask for. */
export type SleepChoice = "off" | "end-of-chapter" | "5" | "10" | "15" | "30" | "45" | "60" | "90";

export const SLEEP_CHOICES: { value: SleepChoice; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "5", label: "5 minutes" }, { value: "10", label: "10 minutes" }, { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" }, { value: "45", label: "45 minutes" }, { value: "60", label: "1 hour" }, { value: "90", label: "1½ hours" },
  { value: "end-of-chapter", label: "End of this chapter" },
];

/** A running timer: stop at a clock time, or when playback reaches a place in the recording. */
export type SleepTimer = { kind: "clock"; endsAt: number } | { kind: "place"; at: number };

export const FADE_MS = 10_000;

export function startSleep(choice: SleepChoice, now: number, whole: number, chapters: Chapter[], total: number): SleepTimer | null {
  if (choice === "off") return null;
  if (choice === "end-of-chapter") return { kind: "place", at: nextTarget(chapters, whole) ?? total };
  return { kind: "clock", endsAt: now + Number(choice) * 60_000 };
}

/** Time left before the timer stops playback, in real time (the playback rate shortens a place-based wait). */
export function remainingMs(t: SleepTimer, now: number, whole: number, rate: number): number {
  return t.kind === "clock" ? t.endsAt - now : Math.max(0, (t.at - whole) / Math.max(rate, 0.25));
}

/** Volume for the last seconds before the stop: a slow fade, never fully silent until the pause itself. */
export function fadeVolume(remaining: number): number {
  if (remaining >= FADE_MS) return 1;
  return Math.max(0.05, remaining / FADE_MS);
}
