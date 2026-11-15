import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

// Thin wrapper around the local ffmpeg/ffprobe binaries. Server-side only.
// FFMPEG_PATH / FFPROBE_PATH override; otherwise prefer Homebrew's ffmpeg-full
// (has the subtitles/drawtext filters the compositor needs), then PATH.

const FULL = "/opt/homebrew/opt/ffmpeg-full/bin";

function bin(name: "ffmpeg" | "ffprobe"): string {
  const override = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (override) return override;
  const full = `${FULL}/${name}`;
  return existsSync(full) ? full : name;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr).trim().split("\n").slice(-4).join(" | ");
        reject(new Error(`${cmd} failed: ${tail || err.message}`));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const ffmpeg = (args: string[], opts?: { cwd?: string }) =>
  run(bin("ffmpeg"), ["-hide_banner", "-nostdin", "-y", ...args], opts);

export interface MediaProbe {
  durationSec: number;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string | null;
  raw: unknown;
}

// Probes a file and requires a decodable video stream. Throws on anything
// that is not a real video (e.g. the mock pipeline's ftyp-only placeholder).
export async function probeVideo(filePath: string): Promise<MediaProbe> {
  const { stdout } = await run(bin("ffprobe"), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const raw = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }[];
  };
  const video = raw.streams?.find((s) => s.codec_type === "video");
  const audio = raw.streams?.find((s) => s.codec_type === "audio");
  const durationSec = Number(raw.format?.duration ?? video?.duration ?? 0);
  if (!video || !video.width || !video.height || !(durationSec > 0)) {
    throw new Error("Not a playable video file (no video stream or zero duration)");
  }
  const [n = 0, d = 0] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationSec,
    width: video.width,
    height: video.height,
    frameRate: d ? Math.round((n / d) * 100) / 100 : 0,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    raw,
  };
}

export async function probeDurationSec(filePath: string): Promise<number> {
  const { stdout } = await run(bin("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  return Number(stdout.trim());
}

// Mean volume in dBFS (volumedetect). Used to reject silent "narration".
export async function meanVolumeDb(filePath: string): Promise<number> {
  const { stderr } = await ffmpeg(["-i", filePath, "-af", "volumedetect", "-f", "null", "-"]);
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  if (!m || m[1] === "-inf") return -Infinity;
  return Number(m[1]);
}
