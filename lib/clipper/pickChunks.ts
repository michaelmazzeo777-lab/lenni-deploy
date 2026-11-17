// Turns a whole-stream transcript into the chunks the operator's assistant
// reads when picking moments. 12-minute windows with 60 seconds of overlap,
// so a moment straddling a boundary is fully visible in one chunk rather
// than split across two and missed by both.
//
// Chunks are written as plain markdown on purpose: the picking step is a
// human-supervised read, not an API call, so the artefact has to be legible
// on its own and reviewable after the fact as job evidence.
import type { TimedWord } from "@/lib/media/align";

export const CHUNK_SEC = 12 * 60;
export const CHUNK_OVERLAP_SEC = 60;

export interface ChunkRange {
  index: number;
  startSec: number;
  endSec: number;
}

/** Inclusive-start, exclusive-end windows covering the whole stream. */
export function chunkRanges(
  durationSec: number,
  chunkSec = CHUNK_SEC,
  overlapSec = CHUNK_OVERLAP_SEC,
): ChunkRange[] {
  if (!(durationSec > 0)) return [];
  // The step never drops below half the window. A caller passing an overlap
  // at or above the window size would otherwise advance a second at a time
  // and emit thousands of near-identical chunks, which is unreadable rather
  // than merely wasteful.
  const step = Math.max(Math.ceil(chunkSec / 2), chunkSec - overlapSec);
  const out: ChunkRange[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSec) {
    const endSec = Math.min(durationSec, start + chunkSec);
    out.push({ index, startSec: start, endSec });
    if (endSec >= durationSec) break;
    start += step;
    index += 1;
  }
  return out;
}

export function timecode(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface EnergyPeak {
  atSec: number;
  /** Normalised 0..1 audio energy, from the existing signal bins. */
  level: number;
}

export interface ChatSpike {
  atSec: number;
  /** Messages per second over the surrounding window. */
  rate: number;
}

export interface ChunkInput {
  range: ChunkRange;
  words: TimedWord[];
  energyPeaks: EnergyPeak[];
  chatSpikes: ChatSpike[];
  /** For the header, so a chunk read in isolation names its source. */
  sourceLabel: string;
}

const inRange = (t: number, r: ChunkRange) => t >= r.startSec && t < r.endSec;

/**
 * Groups a chunk's words into timestamped lines, breaking on a pause. Line
 * timestamps are absolute stream time, which is what the picks must use -
 * a pick expressed in chunk-relative time would silently clip the wrong
 * part of the stream.
 */
export function transcriptLines(
  words: TimedWord[],
  range: ChunkRange,
  pauseSec = 2,
): { atSec: number; text: string }[] {
  const mine = words.filter((w) => inRange(w.startSec, range));
  const lines: { atSec: number; text: string }[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      atSec: current[0]!.startSec,
      text: current.map((w) => w.text).join(" "),
    });
    current = [];
  };
  for (const w of mine) {
    const prev = current[current.length - 1];
    if (prev && w.startSec - prev.endSec >= pauseSec) flush();
    current.push(w);
  }
  flush();
  return lines;
}

/** Renders one chunk as markdown for the picking step. */
export function buildChunkMarkdown(input: ChunkInput): string {
  const { range, sourceLabel } = input;
  const lines = transcriptLines(input.words, range);
  const peaks = input.energyPeaks.filter((p) => inRange(p.atSec, range));
  const spikes = input.chatSpikes.filter((s) => inRange(s.atSec, range));

  const out: string[] = [];
  out.push(`# Chunk ${String(range.index).padStart(3, "0")} — ${sourceLabel}`);
  out.push("");
  out.push(
    `Stream time **${timecode(range.startSec)} to ${timecode(range.endSec)}** ` +
      `(${range.startSec.toFixed(0)}–${range.endSec.toFixed(0)}s). ` +
      `All timestamps below are absolute stream time; use them verbatim in picks.json.`,
  );
  out.push("");

  out.push("## Audio energy peaks");
  out.push("");
  if (peaks.length === 0) {
    out.push("_None in this window._");
  } else {
    for (const p of peaks) {
      out.push(`- ${timecode(p.atSec)} (${p.atSec.toFixed(1)}s) — energy ${p.level.toFixed(2)}`);
    }
  }
  out.push("");

  out.push("## Chat-rate spikes");
  out.push("");
  if (spikes.length === 0) {
    out.push("_No chat replay available for this stream, or no spikes in this window._");
  } else {
    for (const s of spikes) {
      out.push(`- ${timecode(s.atSec)} (${s.atSec.toFixed(1)}s) — ${s.rate.toFixed(1)} msg/s`);
    }
  }
  out.push("");

  out.push("## Transcript");
  out.push("");
  if (lines.length === 0) {
    out.push("_No speech transcribed in this window._");
  } else {
    for (const l of lines) {
      out.push(`**[${timecode(l.atSec)}]** ${l.text}`);
      out.push("");
    }
  }
  return out.join("\n");
}

/** Normalised audio-energy peaks from the existing 1-second signal bins. */
export function energyPeaksFromBins(
  bins: { atSec: number; audioRms: number }[],
  opts: { minLevel?: number; minGapSec?: number } = {},
): EnergyPeak[] {
  if (bins.length === 0) return [];
  const minLevel = opts.minLevel ?? 0.6;
  const minGap = opts.minGapSec ?? 20;
  const max = Math.max(...bins.map((b) => b.audioRms));
  if (!(max > 0)) return [];
  const scaled = bins
    .map((b) => ({ atSec: b.atSec, level: b.audioRms / max }))
    .filter((b) => b.level >= minLevel)
    .sort((a, b) => b.level - a.level);
  const kept: EnergyPeak[] = [];
  for (const cand of scaled) {
    if (kept.every((k) => Math.abs(k.atSec - cand.atSec) >= minGap)) kept.push(cand);
  }
  return kept.sort((a, b) => a.atSec - b.atSec);
}
