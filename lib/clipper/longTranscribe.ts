// Transcribes a multi-hour stream on an 8 GB machine by walking it in
// slices instead of handing whisper.cpp the whole file. Peak memory is
// bounded by one slice, not by the stream's length.
//
// The slice grid here is NOT the picking-chunk grid in pickChunks.ts. These
// slices exist to bound memory and are overlapped so a word cut by a slice
// edge still appears whole in the neighbouring slice; the picking chunks are
// a much coarser editorial window. Conflating the two would let a slice edge
// corrupt a word timestamp, which is what the clipper's no-mid-word-cut
// guarantee depends on.
import { transcribeWindow } from "@/lib/clipper/transcribeWindow";
import type { TimedWord } from "@/lib/media/align";

/** Default slice length. ~10 min of 16 kHz mono is a small sample buffer. */
export const SLICE_SEC = 10 * 60;
/** Overlap between slices, so a word spanning an edge survives in one of them. */
export const SLICE_OVERLAP_SEC = 5;

export interface SliceRange {
  index: number;
  startSec: number;
  endSec: number;
  /** Words starting before this are the previous slice's responsibility. */
  claimFromSec: number;
}

/**
 * Plans overlapping slices covering [0, durationSec]. Each slice claims only
 * the words at or after `claimFromSec`, so the overlap region is transcribed
 * twice but attributed once - no duplicates, and no word lost to an edge.
 */
export function planTranscriptSlices(
  durationSec: number,
  sliceSec = SLICE_SEC,
  overlapSec = SLICE_OVERLAP_SEC,
): SliceRange[] {
  if (!(durationSec > 0)) return [];
  // Same floor as the picking chunks: never advance by less than half a
  // slice, so a bad overlap cannot turn a 4h stream into thousands of
  // whisper invocations.
  const step = Math.max(Math.ceil(sliceSec / 2), sliceSec - overlapSec);
  const out: SliceRange[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSec) {
    const endSec = Math.min(durationSec, start + sliceSec);
    out.push({
      index,
      startSec: start,
      endSec,
      // The first slice claims from zero; later ones claim from where the
      // previous slice's claim ended, i.e. the start of their own overlap.
      claimFromSec: index === 0 ? 0 : start + overlapSec,
    });
    if (endSec >= durationSec) break;
    start += step;
    index += 1;
  }
  return out;
}

/**
 * Keeps each word once, attributing overlap-region words to the slice that
 * claims them. Words are returned in time order.
 */
export function mergeSliceWords(slices: { range: SliceRange; words: TimedWord[] }[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const { range, words } of slices) {
    for (const w of words) {
      // A word is claimed by this slice when it starts at or after the claim
      // point. The final slice also claims anything running past its end.
      if (w.startSec + 1e-6 >= range.claimFromSec) out.push(w);
    }
  }
  out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  // Belt and braces: drop an exact duplicate that survived attribution
  // (identical text at the same timestamp can only be the same utterance).
  return out.filter(
    (w, i) =>
      i === 0 ||
      !(
        w.text === out[i - 1]!.text &&
        Math.abs(w.startSec - out[i - 1]!.startSec) < 1e-3 &&
        Math.abs(w.endSec - out[i - 1]!.endSec) < 1e-3
      ),
  );
}

export interface LongTranscription {
  status: "OK" | "PARTIAL" | "NOT_VERIFIED";
  words: TimedWord[];
  text: string;
  sliceCount: number;
  failedSlices: number;
  reason?: string;
}

/**
 * Transcribes a whole long audio file slice by slice. A slice that fails is
 * counted rather than fatal: a 4h stream should not be lost to one bad
 * window, but the caller is told how many were lost so it never reads as a
 * clean pass.
 */
export async function transcribeLongAudio(
  audioPath: string,
  durationSec: number,
  opts: {
    sliceSec?: number;
    overlapSec?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<LongTranscription> {
  const ranges = planTranscriptSlices(durationSec, opts.sliceSec, opts.overlapSec);
  if (ranges.length === 0) {
    return {
      status: "NOT_VERIFIED",
      words: [],
      text: "",
      sliceCount: 0,
      failedSlices: 0,
      reason: "zero-duration audio",
    };
  }
  const collected: { range: SliceRange; words: TimedWord[] }[] = [];
  let failed = 0;
  let firstReason: string | undefined;

  for (const range of ranges) {
    opts.onProgress?.(range.index, ranges.length);
    try {
      // paddingSec 0: the slice grid already overlaps, so extra padding
      // would re-introduce the duplicate words the claim logic removes.
      const t = await transcribeWindow(audioPath, range.startSec, range.endSec, durationSec, 0);
      if (t.status === "OK") {
        collected.push({ range, words: t.words });
      } else {
        failed += 1;
        firstReason ??= t.reason;
      }
    } catch (e) {
      failed += 1;
      firstReason ??= e instanceof Error ? e.message : "slice transcription failed";
    }
  }

  const words = mergeSliceWords(collected);
  const status = failed === 0 ? "OK" : collected.length === 0 ? "NOT_VERIFIED" : "PARTIAL";
  return {
    status,
    words,
    text: words.map((w) => w.text).join(" "),
    sliceCount: ranges.length,
    failedSlices: failed,
    reason: firstReason,
  };
}
