import { ffmpeg } from "@/lib/media/ffmpeg";

// Real audio measurements (EBU R128 loudness, silence map, clipping). These
// describe the signal; they do not say whether speech is intelligible. That is
// lib/media/transcribe.ts and, in the end, a person listening.

export const LOUDNESS_TARGET_LUFS = -16;
export const LOUDNESS_TOLERANCE_LU = 1;
export const TRUE_PEAK_TARGET_DB = -1.5;
/** Ceiling accepted on the encoded file (lossy AAC overshoots the target slightly). */
export const TRUE_PEAK_MAX_DB = -1;

export interface Loudness {
  integratedLufs: number;
  rangeLu: number;
  truePeakDb: number;
}

const num = (s: string | undefined) => (s === undefined || s === "-inf" ? -Infinity : Number(s));

/** Integrated loudness (LUFS), loudness range and true peak of a whole file. */
export async function measureLoudness(filePath: string): Promise<Loudness> {
  const { stderr } = await ffmpeg([
    "-nostats",
    "-i",
    filePath,
    "-vn",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = /\bI:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1];
  const lra = /\bLRA:\s+(-?[\d.]+) LU/.exec(summary)?.[1];
  const peak = /\bPeak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  if (i === undefined || peak === undefined) throw new Error("Loudness could not be measured");
  return { integratedLufs: num(i), rangeLu: Number(lra ?? 0), truePeakDb: num(peak) };
}

export function loudnessProblems(l: Loudness): string[] {
  const out: string[] = [];
  if (!(Math.abs(l.integratedLufs - LOUDNESS_TARGET_LUFS) <= LOUDNESS_TOLERANCE_LU)) {
    out.push(
      `Integrated loudness is ${l.integratedLufs.toFixed(1)} LUFS; target ${LOUDNESS_TARGET_LUFS} ±${LOUDNESS_TOLERANCE_LU}`,
    );
  }
  if (!(l.truePeakDb <= TRUE_PEAK_MAX_DB)) {
    out.push(`True peak is ${l.truePeakDb.toFixed(1)} dBFS; limit ${TRUE_PEAK_MAX_DB}`);
  }
  return out;
}

export interface Span {
  startSec: number;
  endSec: number;
}

/** Stretches quieter than noiseDb lasting at least minSec. */
export async function detectSilences(
  filePath: string,
  durationSec: number,
  opts: { noiseDb?: number; minSec?: number } = {},
): Promise<Span[]> {
  const { stderr } = await ffmpeg([
    "-nostats",
    "-i",
    filePath,
    "-vn",
    "-af",
    `silencedetect=noise=${opts.noiseDb ?? -45}dB:d=${opts.minSec ?? 0.3}`,
    "-f",
    "null",
    "-",
  ]);
  const spans: Span[] = [];
  let open: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === "start") open = t;
    else if (open !== null) {
      spans.push({ startSec: open, endSec: t });
      open = null;
    }
  }
  if (open !== null) spans.push({ startSec: open, endSec: durationSec });
  return spans;
}

/** Moments where sound starts: time zero if the file opens with sound, then every silence end. */
export function speechOnsets(silences: Span[], durationSec: number): number[] {
  const onsets: number[] = [];
  if (!silences.some((s) => s.startSec <= 0.05)) onsets.push(0);
  for (const s of silences) if (s.endSec < durationSec - 0.05) onsets.push(s.endSec);
  return onsets;
}

/** Share of [startSec, endSec] that is not inside a silence. */
export function audibleShare(silences: Span[], startSec: number, endSec: number): number {
  const len = endSec - startSec;
  if (!(len > 0)) return 0;
  let silent = 0;
  for (const s of silences) {
    silent += Math.max(0, Math.min(endSec, s.endSec) - Math.max(startSec, s.startSec));
  }
  return Math.max(0, 1 - silent / len);
}

export interface ClipStats {
  peakDb: number;
  flatFactor: number;
  clipped: boolean;
}

/**
 * Clipping = the waveform sits flat against full scale. A loud but clean
 * recording has a high peak and a flat factor of zero.
 */
export async function clippingStats(filePath: string): Promise<ClipStats> {
  const { stderr } = await ffmpeg([
    "-nostats",
    "-i",
    filePath,
    "-vn",
    "-af",
    "astats=metadata=0",
    "-f",
    "null",
    "-",
  ]);
  const overall = stderr.slice(stderr.lastIndexOf("Overall"));
  const peakDb = num(/Peak level dB:\s+(-?[\d.]+|-inf)/.exec(overall)?.[1]);
  const flatFactor = Number(/Flat factor:\s+([\d.]+)/.exec(overall)?.[1] ?? 0);
  return { peakDb, flatFactor, clipped: peakDb >= -0.1 && flatFactor > 0 };
}

/** Mean level of the last `ms` milliseconds; a narration that ends mid-word ends loud. */
export async function tailLevelDb(filePath: string, ms = 60): Promise<number> {
  const { stderr } = await ffmpeg([
    "-nostats",
    "-sseof",
    `-${ms / 1000}`,
    "-i",
    filePath,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  return num(/mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1]);
}

export interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** Parses the JSON block that loudnorm prints with print_format=json (first pass). */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm measurement missing");
  const j = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  for (const k of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]) {
    if (typeof j[k] !== "string" || !Number.isFinite(Number(j[k]))) {
      throw new Error(`loudnorm measurement unusable (${k}=${j[k]})`);
    }
  }
  return j as unknown as LoudnormMeasurement;
}

/** Second-pass loudnorm filter using the first pass's measurements. */
export function loudnormApply(m: LoudnormMeasurement): string {
  return (
    `loudnorm=I=${LOUDNESS_TARGET_LUFS}:TP=${TRUE_PEAK_TARGET_DB}:LRA=11:` +
    `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:` +
    `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  );
}

export const LOUDNORM_MEASURE = `loudnorm=I=${LOUDNESS_TARGET_LUFS}:TP=${TRUE_PEAK_TARGET_DB}:LRA=11:print_format=json`;
