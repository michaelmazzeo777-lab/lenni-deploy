// Runs local speech-to-text and precise scene-cut detection over a short
// slice of a long file, instead of the whole thing - whisper only touches
// the shortlisted windows, never the full session. Both offset their
// results back to the source file's absolute timeline.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg } from "@/lib/media/ffmpeg";
import { transcribe, type Transcription } from "@/lib/media/transcribe";
import { detectSilences, type Span } from "@/lib/media/audio-qa";
import type { TimedWord } from "@/lib/media/align";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type WindowTranscription =
  | { status: "OK"; engine: string; model: string; text: string; words: TimedWord[] }
  | { status: "NOT_VERIFIED"; reason: string };

/**
 * Transcribes [startSec, endSec] of `filePath` (padded by `paddingSec` and
 * clamped to the file), with word times offset back to the source file's
 * own timeline so they line up with the signal bins and the stored moment.
 */
export async function transcribeWindow(
  filePath: string,
  startSec: number,
  endSec: number,
  fileDurationSec: number,
  paddingSec = 1,
): Promise<WindowTranscription> {
  const s0 = Math.max(0, startSec - paddingSec);
  const e0 = Math.min(fileDurationSec, endSec + paddingSec);
  return withTmp(async (dir) => {
    const wav = path.join(dir, "w.wav");
    await ffmpeg([
      "-ss",
      String(s0),
      "-to",
      String(e0),
      "-i",
      filePath,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      wav,
    ]);
    const t: Transcription = await transcribe(wav);
    if (t.status === "NOT_VERIFIED") return t;
    return {
      ...t,
      words: t.words.map((w) => ({ ...w, startSec: w.startSec + s0, endSec: w.endSec + s0 })),
    };
  });
}

/** Silence spans (source-file time) within `windowSec` of `centerSec`. */
export async function silencesNear(
  filePath: string,
  centerSec: number,
  fileDurationSec: number,
  windowSec = 3,
): Promise<Span[]> {
  const s0 = Math.max(0, centerSec - windowSec);
  const e0 = Math.min(fileDurationSec, centerSec + windowSec);
  const dur = e0 - s0;
  if (!(dur > 0)) return [];
  return withTmp(async (dir) => {
    const wav = path.join(dir, "s.wav");
    await ffmpeg([
      "-ss",
      String(s0),
      "-to",
      String(e0),
      "-i",
      filePath,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      wav,
    ]);
    const spans = await detectSilences(wav, dur, { minSec: 0.2 });
    return spans.map((s) => ({ startSec: s.startSec + s0, endSec: s.endSec + s0 }));
  });
}

/** Precise scene-cut timestamps (source-file time) within `windowSec` of `centerSec`. */
export async function sceneCutsNear(
  filePath: string,
  centerSec: number,
  fileDurationSec: number,
  windowSec = 3,
): Promise<number[]> {
  const s0 = Math.max(0, centerSec - windowSec);
  const dur = Math.min(fileDurationSec - s0, windowSec * 2);
  if (!(dur > 0)) return [];
  return withTmp(async (dir) => {
    const out = path.join(dir, "cuts.txt");
    await ffmpeg(
      [
        "-ss",
        String(s0),
        "-t",
        String(dur),
        "-i",
        filePath,
        "-vf",
        "scdet=threshold=12,metadata=mode=print:file=cuts.txt",
        "-f",
        "null",
        "-",
      ],
      { cwd: dir },
    );
    const text = await readFile(out, "utf8").catch(() => "");
    const cuts: number[] = [];
    for (const m of text.matchAll(/lavfi\.scd\.time=([\d.]+)/g)) {
      cuts.push(s0 + Number(m[1]));
    }
    return cuts;
  });
}
