import { describe, it, expect } from "vitest";
import {
  MAX_DOWNLOAD_BYTES,
  audioArgs,
  downloadRefusals,
  metadataArgs,
  parseMetadata,
  probeStream,
  sectionArgs,
  sectionSpec,
  sectionTimestamp,
  type CommandRunner,
  type StreamMetadata,
} from "@/lib/clipper/ytdlp";
import { parseStreamUrl } from "@/lib/clipper/streamUrl";

// Recorded-shape yt-dlp --dump-single-json output. Nothing here touches a
// network: the runner is injected and returns this fixture.
const PARSED = parseStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const fakeDump = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "dQw4w9WgXcQ",
    title: "4 hour GTA 6 session",
    channel: "Some Streamer",
    uploader: "Some Streamer",
    uploader_id: "@somestreamer",
    channel_id: "UCabc123",
    duration: 4 * 3600,
    is_live: false,
    live_status: "was_live",
    filesize_approx: 12 * GB,
    formats: [
      { format_id: "140", acodec: "mp4a.40.2", vcodec: "none", filesize: 60 * MB },
      { format_id: "251", acodec: "opus", vcodec: "none", filesize_approx: 48 * MB },
      { format_id: "137", acodec: "none", vcodec: "avc1", filesize: 11 * GB },
    ],
    subtitles: { live_chat: [{ ext: "json" }] },
    ...over,
  });

const runnerReturning =
  (stdout: string): CommandRunner =>
  async () => ({ stdout, stderr: "" });

const base = (over: Partial<StreamMetadata> = {}): StreamMetadata => ({
  platform: "youtube",
  videoId: "dQw4w9WgXcQ",
  canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "t",
  channelName: "Some Streamer",
  channelHandle: "@somestreamer",
  channelId: "UCabc123",
  durationSec: 4 * 3600,
  isLive: false,
  audioBytesEstimate: 48 * MB,
  videoBytesEstimate: 12 * GB,
  hasChatReplay: true,
  ...over,
});

describe("parseMetadata", () => {
  it("reads channel, duration and chat replay from recorded output", async () => {
    const meta = await probeStream(PARSED, runnerReturning(fakeDump()));
    expect(meta).toMatchObject({
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      channelName: "Some Streamer",
      channelId: "UCabc123",
      durationSec: 14400,
      isLive: false,
      hasChatReplay: true,
    });
  });

  it("estimates audio size from the smallest audio-only format, not the video", () => {
    const meta = parseMetadata(fakeDump(), PARSED);
    expect(meta.audioBytesEstimate).toBe(48 * MB);
    expect(meta.videoBytesEstimate).toBe(12 * GB);
  });

  it("reports no chat replay when the stream has none", () => {
    expect(parseMetadata(fakeDump({ subtitles: { en: [] } }), PARSED).hasChatReplay).toBe(false);
  });

  it("flags a live stream", () => {
    expect(parseMetadata(fakeDump({ is_live: true }), PARSED).isLive).toBe(true);
  });

  it("survives missing optional fields rather than throwing", () => {
    const meta = parseMetadata(JSON.stringify({ id: "x" }), PARSED);
    expect(meta.durationSec).toBeNull();
    expect(meta.audioBytesEstimate).toBeNull();
    expect(meta.channelName).toBeNull();
  });

  it("refuses non-JSON output", () => {
    expect(() => parseMetadata("ERROR: unavailable video", PARSED)).toThrow(/not JSON/i);
  });
});

describe("downloadRefusals — the 2 GB gate", () => {
  it("allows an audio-first pull of a 4h stream", () => {
    expect(downloadRefusals(base(), 48 * MB)).toEqual([]);
  });

  it("refuses a planned download over 2 GB and reports the size", () => {
    const problems = downloadRefusals(base(), 3 * GB);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/3\.00 GB/);
    expect(problems[0]).toMatch(/over the 2 GB limit/);
    expect(problems[0]).toMatch(/Stopping to ask first/);
  });

  it("allows a download exactly at the limit and refuses one byte over", () => {
    expect(downloadRefusals(base(), MAX_DOWNLOAD_BYTES)).toEqual([]);
    expect(downloadRefusals(base(), MAX_DOWNLOAD_BYTES + 1)).toHaveLength(1);
  });

  it("does not gate on the full video size, which is never downloaded", () => {
    // videoBytesEstimate is 12 GB, but an audio-first plan is 48 MB.
    expect(downloadRefusals(base({ videoBytesEstimate: 12 * GB }), 48 * MB)).toEqual([]);
  });

  it("refuses a live stream", () => {
    expect(downloadRefusals(base({ isLive: true }), 1).join(" ")).toMatch(/live stream/i);
  });

  it("refuses a stream over the duration ceiling", () => {
    expect(downloadRefusals(base({ durationSec: 9 * 3600 }), 1).join(" ")).toMatch(/over the 8h/i);
  });

  it("refuses a zero-duration stream", () => {
    expect(downloadRefusals(base({ durationSec: 0 }), 1).join(" ")).toMatch(/zero duration/i);
  });

  it("reports every independent reason at once", () => {
    expect(downloadRefusals(base({ isLive: true, durationSec: 9 * 3600 }), 3 * GB)).toHaveLength(3);
  });

  it("does not gate when the size is unknown", () => {
    expect(downloadRefusals(base(), null)).toEqual([]);
  });
});

describe("section specs", () => {
  it("formats timestamps as hh:mm:ss", () => {
    expect(sectionTimestamp(0)).toBe("00:00:00");
    expect(sectionTimestamp(61)).toBe("00:01:01");
    expect(sectionTimestamp(3725)).toBe("01:02:05");
  });

  it("pads the requested range by 3s on each side", () => {
    expect(sectionSpec(100, 130, 14400)).toBe("*00:01:37-00:02:13");
  });

  it("clamps the pad at the start and end of the stream", () => {
    expect(sectionSpec(1, 20, 14400)).toMatch(/^\*00:00:00-/);
    // 14380 - 3 = 14377s = 03:59:37; the end pad clamps to the stream length.
    expect(sectionSpec(14380, 14399, 14400)).toBe("*03:59:37-04:00:00");
  });

  it("refuses an empty range", () => {
    expect(() => sectionSpec(50, 50, 14400, 0)).toThrow(/Empty section/i);
  });
});

describe("argv construction", () => {
  it("never passes cookies on any path", () => {
    const all = [
      ...metadataArgs("https://x/y"),
      ...audioArgs("https://x/y", "/tmp/o.%(ext)s"),
      ...sectionArgs("https://x/y", ["*00:00:10-00:00:40"], "/tmp/s.%(ext)s"),
    ].join(" ");
    expect(all).not.toMatch(/cookies/i);
  });

  it("asks for audio only, at whisper's sample rate", () => {
    const args = audioArgs("https://x/y", "/tmp/o.%(ext)s");
    expect(args).toContain("--extract-audio");
    expect(args).toContain("bestaudio/best");
    expect(args.join(" ")).toMatch(/-ar 16000 -ac 1/);
    expect(args.join(" ")).not.toMatch(/bestvideo/);
  });

  it("passes the URL as its own argv entry, never interpolated", () => {
    const nasty = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=;rm -rf /";
    expect(metadataArgs(nasty).at(-1)).toBe(nasty);
  });

  it("emits one --download-sections per range and cuts at keyframes", () => {
    const args = sectionArgs(
      "https://x/y",
      ["*00:00:10-00:00:40", "*00:05:00-00:05:30"],
      "/t/%(ext)s",
    );
    expect(args.filter((a) => a === "--download-sections")).toHaveLength(2);
    expect(args).toContain("--force-keyframes-at-cuts");
  });

  it("refuses to build a section pull with no ranges", () => {
    expect(() => sectionArgs("https://x/y", [], "/t/%(ext)s")).toThrow(/No sections/i);
  });
});
