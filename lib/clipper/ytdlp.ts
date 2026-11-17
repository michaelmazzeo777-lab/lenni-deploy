// yt-dlp wrapper for the stream clipper. Audio first: the full VOD is never
// downloaded, only its audio track, and later only the chosen video ranges.
//
// Every function takes an injectable runner so the metadata parsing, the size
// gate and the argv construction can be unit-tested against recorded yt-dlp
// output with no network. The default runner is lib/media/ffmpeg's `run`,
// which uses execFile with an argv array - no shell, so a URL or channel
// name is never interpolated into a command string.
import { stat } from "node:fs/promises";
import path from "node:path";
import { run } from "@/lib/media/ffmpeg";
import { precondition } from "@/lib/errors";
import type { ParsedStreamUrl, StreamPlatform } from "@/lib/clipper/streamUrl";

/** Owner-approved ceiling: refuse and ask rather than pull more than this. */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** Streams longer than this are refused outright; 4h is the design target. */
export const MAX_STREAM_DURATION_SEC = 8 * 60 * 60;
/** Pad each requested section so a snap outward still has frames to use. */
export const SECTION_PAD_SEC = 3;

const DEFAULT_BIN = "/opt/homebrew/bin/yt-dlp";

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export function ytdlpBin(): string {
  return process.env.YTDLP_PATH?.trim() || DEFAULT_BIN;
}

export interface StreamMetadata {
  platform: StreamPlatform;
  videoId: string;
  canonicalUrl: string;
  title: string | null;
  channelName: string | null;
  channelHandle: string | null;
  channelId: string | null;
  durationSec: number | null;
  isLive: boolean;
  /** Best-effort audio-only size from the chosen format, bytes. */
  audioBytesEstimate: number | null;
  /** Best-effort full-video size, used only by the size gate. */
  videoBytesEstimate: number | null;
  hasChatReplay: boolean;
}

interface RawDumpFormat {
  format_id?: string;
  vcodec?: string;
  acodec?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
}

interface RawDump {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  uploader_id?: string;
  channel_id?: string;
  duration?: number;
  is_live?: boolean;
  live_status?: string;
  filesize_approx?: number | null;
  formats?: RawDumpFormat[];
  subtitles?: Record<string, unknown>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Parses `yt-dlp --dump-single-json` output. Exported separately from the
 * fetch so tests can feed recorded JSON without a network call.
 */
export function parseMetadata(stdout: string, parsed: ParsedStreamUrl): StreamMetadata {
  let raw: RawDump;
  try {
    raw = JSON.parse(stdout) as RawDump;
  } catch {
    throw precondition("yt-dlp returned output that is not JSON; cannot read stream metadata");
  }
  const audioOnly = (raw.formats ?? []).filter(
    (f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"),
  );
  const audioSizes = audioOnly
    .map((f) => num(f.filesize) ?? num(f.filesize_approx))
    .filter((n): n is number => n !== null);
  const allSizes = (raw.formats ?? [])
    .map((f) => num(f.filesize) ?? num(f.filesize_approx))
    .filter((n): n is number => n !== null);

  const subs = raw.subtitles ?? {};
  return {
    platform: parsed.platform,
    videoId: parsed.videoId,
    canonicalUrl: parsed.canonicalUrl,
    title: raw.title?.trim() || null,
    channelName: (raw.channel ?? raw.uploader)?.trim() || null,
    channelHandle: parsed.channelHandle ?? raw.uploader_id?.trim() ?? null,
    channelId: raw.channel_id?.trim() || null,
    durationSec: num(raw.duration),
    isLive: raw.is_live === true || raw.live_status === "is_live",
    // Smallest audio-only format is what an audio-first pull actually fetches.
    audioBytesEstimate: audioSizes.length ? Math.min(...audioSizes) : null,
    videoBytesEstimate:
      num(raw.filesize_approx) ?? (allSizes.length ? Math.max(...allSizes) : null),
    hasChatReplay: Object.keys(subs).some((k) => k.toLowerCase().includes("live_chat")),
  };
}

/**
 * Reasons to refuse before downloading anything. Pure, so the 2GB gate and
 * the live/duration gates are unit-tested without a network.
 *
 * `plannedBytes` is what this specific step intends to pull (the audio
 * estimate for an audio-first pull, the section estimate for a section
 * pull) - NOT the whole video, which is never downloaded.
 */
export function downloadRefusals(
  meta: StreamMetadata,
  plannedBytes: number | null,
  opts: { maxBytes?: number } = {},
): string[] {
  const max = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const problems: string[] = [];
  if (meta.isLive) {
    problems.push("This is a live stream, not a finished VOD. Clip it after it ends.");
  }
  if (meta.durationSec !== null && meta.durationSec > MAX_STREAM_DURATION_SEC) {
    problems.push(
      `Stream is ${(meta.durationSec / 3600).toFixed(1)}h, over the ${MAX_STREAM_DURATION_SEC / 3600}h limit.`,
    );
  }
  if (meta.durationSec !== null && meta.durationSec <= 0) {
    problems.push("Stream reports zero duration; nothing to clip.");
  }
  if (plannedBytes !== null && plannedBytes > max) {
    problems.push(
      `This download would be ${(plannedBytes / 1024 ** 3).toFixed(2)} GB, over the ` +
        `${(max / 1024 ** 3).toFixed(0)} GB limit. Stopping to ask first.`,
    );
  }
  return problems;
}

/** Formats seconds as yt-dlp's `--download-sections` timestamp. */
export function sectionTimestamp(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Builds the `*start-end` section spec, padded and clamped. Exported so the
 * padding and clamping are testable without invoking yt-dlp.
 */
export function sectionSpec(
  startSec: number,
  endSec: number,
  streamDurationSec: number | null,
  padSec = SECTION_PAD_SEC,
): string {
  const s = Math.max(0, startSec - padSec);
  const rawEnd = endSec + padSec;
  const e = streamDurationSec !== null ? Math.min(streamDurationSec, rawEnd) : rawEnd;
  if (!(e > s)) throw precondition(`Empty section requested: ${startSec}-${endSec}`);
  return `*${sectionTimestamp(s)}-${sectionTimestamp(Math.ceil(e))}`;
}

/** argv for the metadata probe. No download, no cookies. */
export function metadataArgs(canonicalUrl: string): string[] {
  return ["--dump-single-json", "--no-playlist", "--no-warnings", canonicalUrl];
}

/** argv for the audio-only pull. Never fetches a video stream. */
export function audioArgs(canonicalUrl: string, outTemplate: string): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--no-part",
    "-f",
    "bestaudio/best",
    "--extract-audio",
    "--audio-format",
    "wav",
    // 16 kHz mono is exactly what whisper.cpp consumes, so the transcription
    // step needs no second conversion pass over a multi-hour file.
    "--postprocessor-args",
    "ExtractAudio:-ar 16000 -ac 1",
    "-o",
    outTemplate,
    canonicalUrl,
  ];
}

/** argv for a section-only video pull: one `--download-sections` per range. */
export function sectionArgs(canonicalUrl: string, specs: string[], outTemplate: string): string[] {
  if (specs.length === 0) throw precondition("No sections requested");
  const args = ["--no-playlist", "--no-warnings", "--no-part"];
  for (const spec of specs) args.push("--download-sections", spec);
  // Keyframe-accurate cutting; without this yt-dlp can hand back a section
  // that starts before the requested timestamp.
  args.push("--force-keyframes-at-cuts");
  args.push("-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best");
  args.push("--merge-output-format", "mp4");
  args.push("-o", outTemplate, canonicalUrl);
  return args;
}

/** Fetches metadata only. One network call, no media bytes. */
export async function probeStream(
  parsed: ParsedStreamUrl,
  runner: CommandRunner = run,
): Promise<StreamMetadata> {
  const { stdout } = await runner(ytdlpBin(), metadataArgs(parsed.canonicalUrl));
  return parseMetadata(stdout, parsed);
}

/** Bytes actually on disk for a path, or 0 when it does not exist. */
export async function bytesOnDisk(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export interface AudioPullResult {
  filePath: string;
  bytes: number;
}

/**
 * Audio-only download. Refuses before spending bytes when the size gate or a
 * live/duration gate says no. Cookies are deliberately not supported here:
 * the owner's standing instruction is to ask first if a VOD will not download
 * without them, so there is no flag to reach for by reflex.
 */
export async function downloadAudio(
  meta: StreamMetadata,
  outDir: string,
  runner: CommandRunner = run,
): Promise<AudioPullResult> {
  const problems = downloadRefusals(meta, meta.audioBytesEstimate);
  if (problems.length) throw precondition(`Refusing to download: ${problems.join(" ")}`);
  const outTemplate = path.join(outDir, `${meta.videoId}.%(ext)s`);
  await runner(ytdlpBin(), audioArgs(meta.canonicalUrl, outTemplate));
  const filePath = path.join(outDir, `${meta.videoId}.wav`);
  const bytes = await bytesOnDisk(filePath);
  if (bytes === 0) {
    throw precondition(
      "yt-dlp reported success but produced no audio file. If this VOD needs browser " +
        "cookies to download, stop and ask the owner before using them.",
    );
  }
  return { filePath, bytes };
}
