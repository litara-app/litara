import { describe, expect, test } from "vitest";
import { nextTarget, previousTarget, currentChapter, type Chapter } from "./chapters";
import { fadeVolume, remainingMs, startSleep } from "./sleep";

const chapters: Chapter[] = [{ id: "a", label: "One", at: 0 }, { id: "b", label: "Two", at: 60_000 }, { id: "c", label: "Three", at: 180_000 }];

describe("chapter skipping", () => {
  test("next goes to the following chapter and stops at the last", () => {
    expect(nextTarget(chapters, 10_000)).toBe(60_000);
    expect(nextTarget(chapters, 60_000)).toBe(180_000);
    expect(nextTarget(chapters, 200_000)).toBeNull();
  });
  test("previous restarts the chapter after a few seconds, then goes back", () => {
    expect(previousTarget(chapters, 100_000)).toBe(60_000); // well into chapter two: restart it
    expect(previousTarget(chapters, 61_000)).toBe(0); // right at its start: go to chapter one
    expect(previousTarget(chapters, 500)).toBe(0);
  });
  test("a recording with no chapters has nothing to skip to", () => {
    expect(nextTarget([], 5000)).toBeNull();
    expect(previousTarget([], 5000)).toBeNull();
    expect(currentChapter([], 5000)).toBeUndefined();
  });
  test("the current chapter is the last one that has started", () => {
    expect(currentChapter(chapters, 59_999)?.id).toBe("a");
    expect(currentChapter(chapters, 60_000)?.id).toBe("b");
  });
});

describe("sleep timer", () => {
  test("off starts nothing; minutes stop at a clock time", () => {
    expect(startSleep("off", 1000, 0, chapters, 300_000)).toBeNull();
    expect(startSleep("15", 1000, 0, chapters, 300_000)).toEqual({ kind: "clock", endsAt: 1000 + 15 * 60_000 });
  });
  test("end of chapter stops where the next chapter begins, or at the end of the recording", () => {
    expect(startSleep("end-of-chapter", 0, 70_000, chapters, 300_000)).toEqual({ kind: "place", at: 180_000 });
    expect(startSleep("end-of-chapter", 0, 200_000, chapters, 300_000)).toEqual({ kind: "place", at: 300_000 });
  });
  test("remaining time follows the clock, or the place at the playback speed", () => {
    expect(remainingMs({ kind: "clock", endsAt: 5000 }, 2000, 0, 1)).toBe(3000);
    expect(remainingMs({ kind: "place", at: 100_000 }, 0, 40_000, 2)).toBe(30_000);
    expect(remainingMs({ kind: "place", at: 100_000 }, 0, 120_000, 1)).toBe(0);
  });
  test("the volume fades over the last ten seconds and never reaches silence early", () => {
    expect(fadeVolume(60_000)).toBe(1);
    expect(fadeVolume(5000)).toBeCloseTo(0.5);
    expect(fadeVolume(0)).toBeCloseTo(0.05);
  });
});
