import { describe, expect, it } from "vitest";
import { probeType } from "./mime";

describe("probeType", () => {
  it("probes Ogg Opus by its container and codec", () => {
    expect(probeType("audio/opus")).toBe('audio/ogg; codecs="opus"');
    expect(probeType("AUDIO/OPUS")).toBe('audio/ogg; codecs="opus"');
  });
  it("treats the x-m4a/x-m4b aliases as MP4 audio", () => {
    expect(probeType("audio/x-m4a")).toBe("audio/mp4");
    expect(probeType("audio/x-m4b")).toBe("audio/mp4");
  });
  it("leaves every other type untouched", () => {
    for (const m of ["audio/mpeg", "audio/mp4", "audio/flac", "audio/ogg", "audio/wav", "audio/aac"]) expect(probeType(m)).toBe(m);
  });
});
