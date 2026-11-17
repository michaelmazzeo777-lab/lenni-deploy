// Pure functions for the long-session clipper's moment selection: shortlist
// windows from cheap signals, clamp each to a storable length, then snap its
// boundaries to silence or a scene cut - never mid-word. No ffmpeg, no
// whisper here; those run once per shortlisted window in lib/clipper/engine.ts.
import type { Candidate, SignalBin } from "@/lib/media/highlights";
import { rankHighlights } from "@/lib/media/highlights";
import type { TimedWord } from "@/lib/media/align";
import type { Span } from "@/lib/media/audio-qa";

export const CLIP_MIN_SEC = 15;
export const CLIP_MAX_SEC = 60;

/** Top 3xN candidate windows, widened enough that none is lost to clamping. */
export function shortlistWindows(bins: SignalBin[], finalCount: number): Candidate[] {
  return rankHighlights(bins, {
    maxCandidates: Math.max(1, finalCount) * 3,
    maxWindowSec: CLIP_MAX_SEC,
    minScore: 0.1,
  });
}

/**
 * Forces a window into [CLIP_MIN_SEC, CLIP_MAX_SEC], growing or shrinking
 * around its centre, then clamps to the file's bounds. rankHighlights can
 * hand back windows outside this range (short bursts, or a sustained region
 * plus lead-in/aftermath padding over 60s) - every stored clip must still
 * land inside it (A2).
 */
export function clampWindowSec(
  startSec: number,
  endSec: number,
  fileDurationSec: number,
): { startSec: number; endSec: number } {
  let s = startSec;
  let e = Math.max(endSec, startSec + 0.01);
  const len = e - s;
  if (len > CLIP_MAX_SEC) {
    const mid = (s + e) / 2;
    s = mid - CLIP_MAX_SEC / 2;
    e = mid + CLIP_MAX_SEC / 2;
  } else if (len < CLIP_MIN_SEC) {
    const mid = (s + e) / 2;
    s = mid - CLIP_MIN_SEC / 2;
    e = mid + CLIP_MIN_SEC / 2;
  }
  if (s < 0) {
    e -= s;
    s = 0;
  }
  if (e > fileDurationSec) {
    s -= e - fileDurationSec;
    e = fileDurationSec;
  }
  s = Math.max(0, Math.round(s * 100) / 100);
  e = Math.min(fileDurationSec, Math.round(e * 100) / 100);
  return { startSec: s, endSec: e };
}

/** True when any two windows (by index) overlap. */
export function overlaps(
  a: { startSec: number; endSec: number },
  b: { startSec: number; endSec: number },
): boolean {
  return a.startSec < b.endSec && b.startSec < a.endSec;
}

export interface SnapInput {
  startSec: number;
  endSec: number;
  /** Silences detected near the boundaries (not necessarily the whole file). */
  silences: Span[];
  /** Precise scene-cut timestamps near the boundaries. */
  sceneCuts: number[];
  /** Word timestamps covering at least the neighbourhood of both boundaries. */
  words: TimedWord[];
  /** How far from the raw boundary to look for a silence/cut. */
  toleranceSec?: number;
}

function nearest(target: number, candidates: number[], tolerance: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d <= tolerance && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** If `t` lands inside a word, push it to that word's edge so the whole word survives. */
function clearOfWords(t: number, words: TimedWord[], edge: "start" | "end"): number {
  const hit = words.find((w) => t > w.startSec + 1e-3 && t < w.endSec - 1e-3);
  if (!hit) return t;
  return edge === "start" ? hit.startSec : hit.endSec;
}

/**
 * Moves a window's start later (toward silence or a scene cut) and its end
 * earlier (same), within tolerance, then - as a hard constraint that
 * overrides the snap - never leaves either boundary inside a spoken word.
 * Falls back to the original boundary when nothing is found or the snap
 * would invert the window.
 */
export function snapBoundaries(input: SnapInput): { startSec: number; endSec: number } {
  const tol = input.toleranceSec ?? 1.5;
  const startCandidates = [...input.silences.map((s) => s.endSec), ...input.sceneCuts];
  const endCandidates = [...input.silences.map((s) => s.startSec), ...input.sceneCuts];

  let start = nearest(input.startSec, startCandidates, tol) ?? input.startSec;
  let end = nearest(input.endSec, endCandidates, tol) ?? input.endSec;

  start = clearOfWords(start, input.words, "start");
  end = clearOfWords(end, input.words, "end");

  if (!(end > start)) {
    start = input.startSec;
    end = input.endSec;
  }
  return { startSec: Math.round(start * 100) / 100, endSec: Math.round(end * 100) / 100 };
}
