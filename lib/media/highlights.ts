import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg } from "@/lib/media/ffmpeg";

// Explainable highlight ranking over one local video. Deterministic, cheap
// signals only (no ML): frame motion, audio level, audio onset, scene cuts,
// with black/still exclusion. The score ranks how *exciting a window looks
// and sounds* - it says nothing about whether a gameplay claim is true.

export const ANALYZER_VERSION = "local-signals-1";

// Calibrated on the synthetic fixtures only (see scripts/highlight-benchmark.ts).
// Motion dominates so quiet-but-busy action still ranks.
export const WEIGHTS = { motion: 0.5, audioLevel: 0.2, audioOnset: 0.2, sceneCuts: 0.1 };

export interface SignalBin {
  t: number; // bin start, seconds (1s bins)
  motion: number; // mean absolute frame difference (0-255 scale)
  luma: number; // mean luma 0-255
  cuts: number; // scene changes detected in the bin
  rmsDb: number; // audio RMS, dBFS (-120 when silent / no audio)
}

export interface Candidate {
  rank: number;
  startSec: number;
  endSec: number;
  peakSec: number;
  score: number;
  signals: {
    motion: number;
    audioLevel: number;
    audioOnset: number;
    sceneCuts: number;
    reasons: string[];
  };
}

function parseMetadata(text: string): { t: number; kv: Record<string, string> }[] {
  const frames: { t: number; kv: Record<string, string> }[] = [];
  for (const line of text.split("\n")) {
    const head = /pts_time:([\d.]+)/.exec(line);
    if (head) frames.push({ t: Number(head[1]), kv: {} });
    else if (frames.length && line.includes("=")) {
      const i = line.indexOf("=");
      frames.at(-1)!.kv[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return frames;
}

// One ffmpeg pass -> 1-second signal bins. Source timecodes are preserved.
export async function extractSignals(filePath: string, hasAudio: boolean): Promise<SignalBin[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "hl-"));
  try {
    const graph =
      "[0:v]fps=4,scale=160:90,format=gray,scdet=threshold=12,signalstats," +
      "metadata=mode=print:file=v.txt[v]" +
      (hasAudio
        ? ";[0:a]aresample=16000,asetnsamples=n=8000:p=0,astats=metadata=1:reset=1," +
          "ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=a.txt[a]"
        : "");
    const maps = ["-map", "[v]", "-f", "null", "-"];
    if (hasAudio) maps.push("-map", "[a]", "-f", "null", "-");
    await ffmpeg(["-i", filePath, "-filter_complex", graph, ...maps], { cwd: dir });

    const video = parseMetadata(await readFile(path.join(dir, "v.txt"), "utf8"));
    const audio = hasAudio ? parseMetadata(await readFile(path.join(dir, "a.txt"), "utf8")) : [];

    const n = Math.max(1, Math.ceil((video.at(-1)?.t ?? 0) + 0.25));
    const acc = Array.from({ length: n }, () => ({ m: 0, l: 0, v: 0, cuts: 0, p: 0, a: 0 }));
    for (const f of video) {
      const b = acc[Math.min(n - 1, Math.floor(f.t))]!;
      b.m += Number(f.kv["lavfi.scd.mafd"] ?? 0);
      b.l += Number(f.kv["lavfi.signalstats.YAVG"] ?? 0);
      b.v += 1;
      if (f.kv["lavfi.scd.time"] !== undefined) b.cuts += 1;
    }
    for (const f of audio) {
      const db = Number(f.kv["lavfi.astats.Overall.RMS_level"]);
      const b = acc[Math.min(n - 1, Math.floor(f.t))]!;
      b.p += Number.isFinite(db) ? 10 ** (db / 10) : 0; // mean power
      b.a += 1;
    }
    return acc.map((b, t) => ({
      t,
      motion: b.v ? b.m / b.v : 0,
      luma: b.v ? b.l / b.v : 0,
      cuts: b.cuts,
      rmsDb: b.a && b.p > 0 ? Math.max(-120, 10 * Math.log10(b.p / b.a)) : -120,
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

const BLACK_LUMA = 16;
const STILL_MOTION = 0.05;
const MOTION_FLOOR = 0.5;
const AUDIO_FLOOR_DB = -50;

// Pure ranking over signal bins (unit-testable without ffmpeg).
export function rankHighlights(
  bins: SignalBin[],
  opts: { maxCandidates?: number; minScore?: number; maxWindowSec?: number } = {},
): Candidate[] {
  const maxCandidates = opts.maxCandidates ?? 8;
  const minScore = opts.minScore ?? 0.15;
  const maxWindow = opts.maxWindowSec ?? 30;
  if (bins.length === 0) return [];

  // Clip-relative ceilings with absolute minimums, so a uniformly dull clip
  // does not get its noise stretched into "highlights".
  // 3-bin median on motion: a hard cut produces a one-bin frame-difference
  // spike that is not sustained action.
  const med = bins.map((_, i) => {
    const w = bins.slice(Math.max(0, i - 1), i + 2).map((b) => b.motion);
    return w.sort((x, y) => x - y)[Math.floor(w.length / 2)]!;
  });
  bins = bins.map((b, i) => ({ ...b, motion: Math.min(b.motion, med[i]!) }));
  const motionTop = Math.max(
    3,
    percentile(
      bins.map((b) => b.motion),
      0.95,
    ),
  );
  const audioTop = Math.max(
    -25,
    percentile(
      bins.map((b) => b.rmsDb),
      0.95,
    ),
  );

  const parts = bins.map((b, i) => {
    const dead = b.luma < BLACK_LUMA ? "black" : b.motion < STILL_MOTION ? "still" : null;
    const prior = bins.slice(Math.max(0, i - 3), i).map((p) => Math.max(AUDIO_FLOOR_DB, p.rmsDb));
    const priorMean = prior.length ? prior.reduce((a, c) => a + c, 0) / prior.length : b.rmsDb;
    const p = {
      dead,
      motion: clamp01((b.motion - MOTION_FLOOR) / (motionTop - MOTION_FLOOR)),
      audioLevel: clamp01((b.rmsDb - AUDIO_FLOOR_DB) / (audioTop - AUDIO_FLOOR_DB)),
      audioOnset: clamp01((Math.max(AUDIO_FLOOR_DB, b.rmsDb) - priorMean) / 20),
      sceneCuts: clamp01(b.cuts / 2),
      score: 0,
    };
    // Black frames and still frames (menus, loading) never score, however loud.
    p.score = dead
      ? 0
      : WEIGHTS.motion * p.motion +
        WEIGHTS.audioLevel * p.audioLevel +
        WEIGHTS.audioOnset * p.audioOnset +
        WEIGHTS.sceneCuts * p.sceneCuts;
    return p;
  });

  const smooth = parts.map((_, i) => {
    const w = parts.slice(Math.max(0, i - 1), i + 2);
    return w.reduce((a, c) => a + c.score, 0) / w.length;
  });

  const taken = new Array<boolean>(bins.length).fill(false);
  const order = smooth.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const out: Candidate[] = [];
  for (const { s: peak, i } of order) {
    if (out.length >= maxCandidates || peak < minScore) break;
    if (taken[i]) continue;
    // Grow the active region while the score stays above half the peak, then
    // add lead-in context and aftermath.
    let a = i;
    let z = i;
    while (a > 0 && smooth[a - 1]! >= peak * 0.5 && z - a < maxWindow) a--;
    while (z < bins.length - 1 && smooth[z + 1]! >= peak * 0.5 && z - a < maxWindow) z++;
    const start = Math.max(0, a - 2);
    const end = Math.min(bins.length, z + 1 + 2);
    // Suppress near-duplicates: skip if most of this window is already used.
    const overlap = taken.slice(start, end).filter(Boolean).length / (end - start);
    for (let k = start; k < end; k++) taken[k] = true;
    if (overlap > 0.4) continue;

    const win = parts.slice(a, z + 1);
    const avg = (f: (p: (typeof parts)[number]) => number) =>
      win.reduce((acc, p) => acc + f(p), 0) / win.length;
    const sig = {
      motion: avg((p) => p.motion),
      audioLevel: avg((p) => p.audioLevel),
      audioOnset: Math.max(...win.map((p) => p.audioOnset)),
      sceneCuts: avg((p) => p.sceneCuts),
    };
    const reasons: string[] = [];
    if (sig.motion >= 0.5) reasons.push(`high on-screen motion (${sig.motion.toFixed(2)})`);
    else if (sig.motion >= 0.2) reasons.push(`moderate motion (${sig.motion.toFixed(2)})`);
    if (sig.audioLevel >= 0.5) reasons.push(`loud audio (${sig.audioLevel.toFixed(2)})`);
    if (sig.audioOnset >= 0.5) reasons.push("sudden audio onset");
    if (sig.sceneCuts > 0.1) reasons.push("scene changes");
    if (sig.motion >= 0.5 && sig.audioLevel < 0.2) reasons.push("quiet but visually busy");
    const dead = parts.slice(start, end).filter((p) => p.dead).length;
    if (dead) reasons.push(`${dead}s of black/still frames inside window (review trim)`);

    out.push({
      rank: out.length + 1,
      startSec: bins[start]!.t,
      endSec: bins[end - 1]!.t + 1,
      peakSec: bins[i]!.t + 0.5,
      score: Math.round(peak * 1000) / 1000,
      signals: { ...sig, reasons },
    });
  }
  return out;
}

export async function extractThumbnail(filePath: string, atSec: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "th-"));
  try {
    const out = path.join(dir, "t.jpg");
    await ffmpeg([
      "-ss",
      String(Math.max(0, atSec)),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-2",
      "-q:v",
      "4",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
