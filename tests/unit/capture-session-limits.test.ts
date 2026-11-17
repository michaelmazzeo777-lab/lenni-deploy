import { describe, it, expect } from "vitest";
import {
  MAX_SESSION_DURATION_SEC,
  MAX_SESSION_SIZE_BYTES,
  sessionMediaProblems,
} from "@/domain/captureMedia";
import type { MediaProbe } from "@/lib/media/ffmpeg";

const okProbe: MediaProbe = {
  durationSec: 600,
  width: 1920,
  height: 1080,
  frameRate: 60,
  videoCodec: "h264",
  audioCodec: "aac",
  raw: null,
};

describe("sessionMediaProblems", () => {
  it("passes a normal gameplay file", () => {
    expect(sessionMediaProblems(okProbe, 500_000_000)).toEqual([]);
  });

  it("names the duration ceiling when it is exceeded, with a clear reason", () => {
    const problems = sessionMediaProblems(
      { ...okProbe, durationSec: MAX_SESSION_DURATION_SEC + 1 },
      1000,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/duration/);
    expect(problems[0]).toMatch(/2h limit/);
  });

  it("names the size ceiling when it is exceeded, with a clear reason", () => {
    const problems = sessionMediaProblems(okProbe, MAX_SESSION_SIZE_BYTES + 1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/size/);
    expect(problems[0]).toMatch(/20GB limit/);
  });

  it("names an unsupported codec, with a clear reason", () => {
    const problems = sessionMediaProblems({ ...okProbe, videoCodec: "vp9" }, 1000);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/vp9/);
  });

  it("accepts hevc as well as h264", () => {
    expect(sessionMediaProblems({ ...okProbe, videoCodec: "hevc" }, 1000)).toEqual([]);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = sessionMediaProblems(
      { ...okProbe, durationSec: MAX_SESSION_DURATION_SEC + 1, videoCodec: "vp9" },
      MAX_SESSION_SIZE_BYTES + 1,
    );
    expect(problems).toHaveLength(3);
  });
});
