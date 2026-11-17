// Cuts one moment out of a long session and renders it in one target format:
// crop (center-weighted by default, blurred-fill as a config option), burned
// captions, loudness-normalized audio. Deliberately NOT shared with
// lib/shorts/local-providers.ts's compositor: that one mixes a narration
// track under ducked game audio; a session clip has one audio stream and no
// narration, so its corrective-loudness loop is written fresh here rather
// than forcing two different audio topologies through one function.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, probeVideo } from "@/lib/media/ffmpeg";
import {
  LOUDNESS_TARGET_LUFS,
  LOUDNORM_MEASURE,
  TRUE_PEAK_MAX_DB,
  TRUE_PEAK_TARGET_DB,
  loudnormApply,
  measureLoudness,
  parseLoudnormJson,
  type Loudness,
} from "@/lib/media/audio-qa";
import type { Cue, RenderFormat } from "@/lib/media/captions";
import { buildClipAss } from "@/lib/clipper/captions";

export type CropMode = "center-crop" | "blurred-fill";

const SIZE: Record<RenderFormat, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
};

/** Center-weighted crop (default) fills the frame and crops the overflow at
 * its center; blurred-fill (config option) keeps the whole picture, padded
 * by a blurred copy of itself, like the explainer compositor's 9:16 layout. */
function cropFilter(w: number, h: number, mode: CropMode): string {
  if (mode === "blurred-fill") {
    return (
      `split[a][b];` +
      `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:2,eq=brightness=-0.12[bg];` +
      `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`
    );
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "clipper-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface RenderClipInput {
  sourcePath: string;
  startSec: number;
  endSec: number;
  format: RenderFormat;
  cropMode: CropMode;
  cues: Cue[];
  hasSourceAudio: boolean;
}

export interface RenderClipResult {
  videoBytes: Buffer;
  coverJpg: Buffer;
  durationSec: number;
  resolution: string;
  frameRate: number;
  loudness: Loudness;
}

export async function renderClip(input: RenderClipInput): Promise<RenderClipResult> {
  const { w, h } = SIZE[input.format];
  const dur = input.endSec - input.startSec;

  return withTmp(async (dir) => {
    await writeFile(
      path.join(dir, "c.ass"),
      buildClipAss({ format: input.format, durationSec: dur, cues: input.cues }),
    );
    const inputArgs = ["-ss", String(input.startSec), "-t", String(dur), "-i", input.sourcePath];
    const video = `[0:v]fps=30,${cropFilter(w, h, input.cropMode)},ass=c.ass[v]`;
    const audio = input.hasSourceAudio
      ? `[0:a]${LOUDNORM_MEASURE}[au]`
      : `anullsrc=sample_rate=48000:channel_layout=mono,atrim=0:${dur},${LOUDNORM_MEASURE}[au]`;

    const pass1 = await ffmpeg(
      [
        ...inputArgs,
        "-filter_complex",
        audio,
        "-map",
        "[au]",
        "-t",
        String(dur),
        "-f",
        "null",
        "-",
      ],
      { cwd: dir },
    );
    const measured = parseLoudnormJson(pass1.stderr);
    const audioChain = input.hasSourceAudio
      ? `[0:a]${loudnormApply(measured)}`
      : `anullsrc=sample_rate=48000:channel_layout=mono,atrim=0:${dur},${loudnormApply(measured)}`;

    let out = path.join(dir, "out.mp4");
    await ffmpeg(
      [
        ...inputArgs,
        "-filter_complex",
        `${video};${audioChain}[au]`,
        "-map",
        "[v]",
        "-map",
        "[au]",
        "-t",
        String(dur),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        out,
      ],
      { cwd: dir },
    );

    // Corrective pass: the AAC encoder can lift the true peak after loudnorm
    // set it, and loudnorm itself can land a little off on a short clip. Fresh,
    // simplified version of the loop in LocalFfmpegCompositorProvider.render -
    // one audio stream here, no narration mix, so it is not shared with it.
    const first = out;
    let gainDb = 0;
    let limitDb = TRUE_PEAK_TARGET_DB;
    for (let pass = 1; pass <= 3; pass++) {
      const got = await measureLoudness(out);
      const miss = LOUDNESS_TARGET_LUFS - got.integratedLufs;
      const over = Math.max(0, got.truePeakDb - (TRUE_PEAK_MAX_DB - 0.3));
      if (Math.abs(miss) <= 0.5 && over === 0) break;
      if (Math.abs(miss) > 0.5) gainDb += miss;
      limitDb -= over + 0.2;
      const limit = Math.pow(10, limitDb / 20).toFixed(3);
      out = path.join(dir, `out${pass}.mp4`);
      await ffmpeg(
        [
          "-i",
          first,
          "-filter_complex",
          `[0:a]volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:level=false[au]`,
          "-map",
          "0:v",
          "-map",
          "[au]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          out,
        ],
        { cwd: dir },
      );
    }

    const probe = await probeVideo(out);
    if (probe.width !== w || probe.height !== h || !probe.audioCodec) {
      throw new Error(`Clip render validation failed: got ${probe.width}x${probe.height}`);
    }
    const cover = path.join(dir, "cover.jpg");
    await ffmpeg(
      ["-ss", String(Math.min(1, dur / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", cover],
      { cwd: dir },
    );
    const loudness = await measureLoudness(out);
    return {
      videoBytes: await readFile(out),
      coverJpg: await readFile(cover),
      durationSec: Math.round(probe.durationSec * 100) / 100,
      resolution: `${w}x${h}`,
      frameRate: 30,
      loudness,
    };
  });
}
