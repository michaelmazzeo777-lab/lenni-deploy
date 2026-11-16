import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, probeDurationSec } from "@/lib/media/ffmpeg";
import {
  audibleShare,
  clippingStats,
  detectSilences,
  loudnessProblems,
  measureLoudness,
  speechOnsets,
  tailLevelDb,
  type Loudness,
} from "@/lib/media/audio-qa";
import {
  compareScript,
  lineOnset,
  scriptProblems,
  type ScriptComparison,
  type SilenceSpan,
} from "@/lib/media/align";
import { transcribe } from "@/lib/media/transcribe";
import {
  CAPTION_STYLE,
  captionBand,
  captionLineCount,
  type Cue,
  type RenderFormat,
} from "@/lib/media/captions";
import { cardWindow, valueBand, type CardsPlan } from "@/lib/media/cards";

// Automatic quality checks for narration and for rendered masters. Every
// check is run on the actual file. A check that could not be run is recorded
// as NOT_VERIFIED - it never counts as a pass - and whatever only a person can
// judge is listed under humanValidation.

export type QaStatus = "PASS" | "FAIL" | "WARN" | "NOT_VERIFIED";
export interface QaCheck {
  name: string;
  status: QaStatus;
  detail: string;
}
export interface QaReport {
  passed: boolean; // no FAIL
  verified: boolean; // no NOT_VERIFIED either
  checks: QaCheck[];
  measurements: Record<string, unknown>;
  humanValidation: string[];
}

export const LISTENING_REQUIRED = "HUMAN LISTENING VALIDATION REQUIRED";
const ALWAYS_HUMAN = [
  "Listen to the narration: voice quality, pronunciation and pacing",
  "Editorial accuracy and tone against the cited sources",
];

function finish(
  checks: QaCheck[],
  measurements: Record<string, unknown>,
  human: string[],
): QaReport {
  return {
    passed: !checks.some((c) => c.status === "FAIL"),
    verified: !checks.some((c) => c.status === "NOT_VERIFIED"),
    checks,
    measurements,
    humanValidation: [...new Set([...human, ...ALWAYS_HUMAN])],
  };
}

export const qaFailures = (r: QaReport) =>
  r.checks.filter((c) => c.status === "FAIL").map((c) => `${c.name}: ${c.detail}`);

const ONSET_TOLERANCE_SEC = 0.35;
const WORD_TIME_TOLERANCE_SEC = 0.75;

function transcriptChecks(
  cmp: ScriptComparison,
  cues: Cue[],
  maxWer: number | null | undefined,
  syncTolerance: number,
  silences?: SilenceSpan[],
): QaCheck[] {
  const checks: QaCheck[] = [];
  const problems = scriptProblems(cmp, maxWer);
  checks.push({
    name: "Speech matches script",
    status: problems.length ? "FAIL" : "PASS",
    detail: problems.length
      ? problems.join("; ")
      : `word error rate ${(cmp.wer * 100).toFixed(0)}%, every line heard`,
  });
  if (cmp.mismatches.length > 0 && problems.length === 0) {
    checks.push({
      name: "Words heard differently",
      status: "WARN",
      detail: cmp.mismatches
        .slice(0, 8)
        .map(([want, got]) => (got ? `"${want}" heard as "${got}"` : `"${want}" not heard`))
        .join("; "),
    });
  }
  // Where each line is heard to start. With a silence map (narration alone)
  // the transcriber's time is corrected to the real speech onset; without one
  // (voice over game audio) a caption may start anywhere inside its line's
  // first word, give or take the tolerance.
  const late = cues
    .map((cue, i) => ({ cue, i, line: cmp.lines[i] }))
    .filter((x) => {
      if (!x.line || x.line.startSec === null) return false;
      if (silences) {
        return Math.abs(lineOnset(x.line.startSec, silences) - x.cue.startSec) > syncTolerance;
      }
      return (
        x.cue.startSec < x.line.startSec - syncTolerance ||
        x.cue.startSec > (x.line.firstWordEndSec ?? x.line.startSec) + syncTolerance
      );
    })
    .map((x) => ({
      ...x,
      at: silences ? lineOnset(x.line!.startSec!, silences) : x.line!.startSec!,
    }));
  checks.push({
    name: "Captions follow the transcript",
    status: late.length ? "FAIL" : "PASS",
    detail: late.length
      ? late
          .map(
            (x) =>
              `caption ${x.i + 1} starts at ${x.cue.startSec.toFixed(2)}s but its words begin at ${x.at!.toFixed(2)}s`,
          )
          .join("; ")
      : `each line's first word is within ${syncTolerance}s of its caption`,
  });
  return checks;
}

/**
 * Narration track alone: clipping, leading silence, dead air inside a line,
 * a cut-off ending, speech-to-script match, and caption timing against the
 * real speech onsets. `cues` are one per script line.
 */
export async function narrationQa(input: {
  wavPath: string;
  lines: string[];
  cues: Cue[];
  cueTiming: "EXACT" | "TRANSCRIPT_ALIGNED" | "APPROXIMATE";
}): Promise<QaReport> {
  const { wavPath, lines, cues } = input;
  const checks: QaCheck[] = [];
  const human: string[] = [];
  const durationSec = await probeDurationSec(wavPath);

  const clip = await clippingStats(wavPath);
  checks.push({
    name: "No clipping",
    status: clip.clipped ? "FAIL" : "PASS",
    detail: clip.clipped
      ? `the waveform is flat against full scale (peak ${clip.peakDb.toFixed(1)} dBFS); re-record at a lower level`
      : `peak ${clip.peakDb.toFixed(1)} dBFS`,
  });

  // Short pauses count: lines are often only a quarter of a second apart.
  const silences = await detectSilences(wavPath, durationSec, { minSec: 0.15 });
  const lead = silences.find((s) => s.startSec <= 0.05);
  const leadSec = lead ? lead.endSec - lead.startSec : 0;
  checks.push({
    name: "Starts promptly",
    status: leadSec > 1 ? "FAIL" : "PASS",
    detail: `${leadSec.toFixed(2)}s of silence before the first word`,
  });

  const gaps = silences
    .filter((s) => s.endSec - s.startSec >= 1.5)
    .map((s) => ({
      s,
      line: cues.findIndex((c) => s.startSec >= c.startSec + 0.1 && s.endSec <= c.endSec - 0.1),
    }))
    .filter((g) => g.line >= 0);
  checks.push({
    name: "No dead air inside a line",
    status: gaps.length ? "FAIL" : "PASS",
    detail: gaps.length
      ? gaps
          .map(
            (g) =>
              `${(g.s.endSec - g.s.startSec).toFixed(1)}s of silence inside line ${g.line + 1} at ${g.s.startSec.toFixed(1)}s`,
          )
          .join("; ")
      : "no pause of 1.5s or more inside a spoken line",
  });

  const tail = await tailLevelDb(wavPath);
  checks.push({
    name: "Ends cleanly",
    status: tail > -35 ? "FAIL" : "PASS",
    detail:
      tail > -35
        ? `the audio is still at ${tail.toFixed(0)} dB when it stops at ${durationSec.toFixed(1)}s (possibly cut off mid-word)`
        : "the narration fades to silence before it ends",
  });

  const t = await transcribe(wavPath);
  let cmp: ScriptComparison | null = null;
  if (t.status === "OK") {
    cmp = compareScript(lines, t.words);
    checks.push(...transcriptChecks(cmp, cues, undefined, WORD_TIME_TOLERANCE_SEC, silences));
  } else {
    checks.push({ name: "Speech matches script", status: "NOT_VERIFIED", detail: t.reason });
    human.push(`${LISTENING_REQUIRED}: narration was not transcribed (${t.reason})`);
  }

  // Caption starts against where sound actually begins.
  const onsets = speechOnsets(silences, durationSec);
  const off = cues
    .map((cue, i) => {
      const near = Math.min(...onsets.map((o) => Math.abs(o - cue.startSec)), Infinity);
      // Continuous speech has no silence to anchor on: then the caption must
      // start inside its line's first word.
      const line = cmp?.lines[i];
      const byWord =
        line && line.startSec !== null
          ? cue.startSec >= line.startSec - ONSET_TOLERANCE_SEC &&
            cue.startSec <= (line.firstWordEndSec ?? line.startSec) + ONSET_TOLERANCE_SEC
          : false;
      return { i, cue, ok: near <= ONSET_TOLERANCE_SEC || byWord, near };
    })
    .filter((x) => !x.ok);
  if (input.cueTiming === "APPROXIMATE" && !cmp) {
    checks.push({
      name: "Captions start with the speech",
      status: "NOT_VERIFIED",
      detail: "caption times were estimated from text length and no transcript was available",
    });
    human.push("CAPTION SYNC: HUMAN CHECK REQUIRED (estimated caption timing)");
  } else {
    checks.push({
      name: "Captions start with the speech",
      status: off.length ? "FAIL" : "PASS",
      detail: off.length
        ? off
            .map(
              (x) =>
                `caption ${x.i + 1} starts at ${x.cue.startSec.toFixed(2)}s, ${x.near.toFixed(2)}s from the nearest speech onset`,
            )
            .join("; ")
        : `every caption starts within ${ONSET_TOLERANCE_SEC}s of a speech onset`,
    });
  }

  return finish(
    checks,
    {
      durationSec,
      peakDb: clip.peakDb,
      silences: silences.length,
      transcript: t.status === "OK" ? t.text : null,
      transcriber: t.status === "OK" ? `${t.engine} ${t.model}` : null,
      wer: cmp ? Number(cmp.wer.toFixed(3)) : null,
      lineRecall: cmp ? cmp.lines.map((l) => Number(l.recall.toFixed(2))) : null,
      cueTiming: input.cueTiming,
    },
    human,
  );
}

export async function bandStats(
  masterPath: string,
  atSec: number,
  band: { x: number; y: number; w: number; h: number },
): Promise<{ ymax: number; yavg: number }> {
  const { stdout } = await ffmpeg([
    "-nostats",
    "-v",
    "error",
    "-ss",
    atSec.toFixed(3),
    "-i",
    masterPath,
    "-frames:v",
    "1",
    "-vf",
    `crop=${band.w}:${band.h}:${band.x}:${band.y},signalstats,metadata=print:file=-`,
    "-f",
    "null",
    "-",
  ]);
  return {
    ymax: Number(/signalstats\.YMAX=(\d+)/.exec(stdout)?.[1] ?? 0),
    yavg: Number(/signalstats\.YAVG=([\d.]+)/.exec(stdout)?.[1] ?? 0),
  };
}

/** Which captions will not fit their line limit on screen; empty when all fit. */
export function captionFitProblems(cues: Cue[], format: RenderFormat): string[] {
  const max = CAPTION_STYLE[format].maxLines;
  return cues
    .map((c, i) => ({ i, lines: captionLineCount(c.text, format) }))
    .filter((x) => x.lines > max)
    .map(
      (x) =>
        `caption ${x.i + 1} needs ${x.lines} lines; ${format} allows ${max} before it leaves the safe area`,
    );
}

async function contactSheet(
  masterPath: string,
  times: number[],
  format: RenderFormat,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "sheet-"));
  try {
    const w = format === "9:16" ? 270 : 480;
    for (const [i, t] of times.entries()) {
      await ffmpeg([
        "-v",
        "error",
        "-ss",
        t.toFixed(3),
        "-i",
        masterPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${w}:-2`,
        "-q:v",
        "4",
        path.join(dir, `f${String(i).padStart(2, "0")}.jpg`),
      ]);
    }
    const cols = Math.min(times.length, format === "9:16" ? 5 : 4);
    const rows = Math.ceil(times.length / cols);
    const out = path.join(dir, "sheet.jpg");
    await ffmpeg([
      "-v",
      "error",
      "-framerate",
      "1",
      "-i",
      path.join(dir, "f%02d.jpg"),
      "-vf",
      `tile=${cols}x${rows}:padding=6:color=0x202020`,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The finished master, start to end: loudness, narration under every caption,
 * speech-to-script match, caption timing, black frames, every card and every
 * caption visibly in the picture, captions inside the safe area. Also returns
 * a contact sheet (opening, every card or caption, closing).
 */
export async function renderQa(input: {
  masterPath: string;
  format: RenderFormat;
  durationSec: number;
  /** One cue per script line (narration timing). */
  lineCues: Cue[];
  /** The captions as burned in (lines split to fit the frame). */
  displayCues: Cue[];
  lines: string[];
  hasSourceAudio: boolean;
  cards?: CardsPlan;
}): Promise<{ report: QaReport; contactSheet: Buffer; loudness: Loudness }> {
  const { masterPath, format, durationSec, lineCues, displayCues } = input;
  const checks: QaCheck[] = [];
  const human: string[] = [];

  const loudness = await measureLoudness(masterPath);
  const loud = loudnessProblems(loudness);
  checks.push({
    name: "Loudness",
    status: loud.length ? "FAIL" : "PASS",
    detail: loud.length
      ? loud.join("; ")
      : `${loudness.integratedLufs.toFixed(1)} LUFS integrated, true peak ${loudness.truePeakDb.toFixed(1)} dBFS, range ${loudness.rangeLu.toFixed(1)} LU`,
  });

  if (!input.hasSourceAudio) {
    const silences = await detectSilences(masterPath, durationSec);
    const quiet = lineCues
      .map((c, i) => ({ i, share: audibleShare(silences, c.startSec, c.endSec) }))
      .filter((x) => x.share < 0.5);
    checks.push({
      name: "Narration under every line",
      status: quiet.length ? "FAIL" : "PASS",
      detail: quiet.length
        ? quiet.map((x) => `line ${x.i + 1} is mostly silent in the master`).join("; ")
        : "every line's time span carries sound",
    });
  }

  const t = await transcribe(masterPath);
  let cmp: ScriptComparison | null = null;
  if (t.status === "OK") {
    // Only what is heard while the narration runs is compared with the script:
    // over music or game sound alone a transcriber writes words nobody said.
    const speechEnd = Math.max(0, ...lineCues.map((c) => c.endSec)) + 1;
    cmp = compareScript(
      input.lines,
      t.words.filter((w) => w.startSec <= speechEnd),
    );
    // With game audio under the voice the overall error rate is not a fair
    // gate (stray words between lines); every line must still be heard.
    checks.push(
      ...transcriptChecks(
        cmp,
        lineCues,
        input.hasSourceAudio ? null : undefined,
        WORD_TIME_TOLERANCE_SEC,
      ),
    );
  } else {
    checks.push({ name: "Speech matches script", status: "NOT_VERIFIED", detail: t.reason });
    human.push(`${LISTENING_REQUIRED}: the master was not transcribed (${t.reason})`);
  }

  // ---- Picture -------------------------------------------------------------
  const { stderr } = await ffmpeg([
    "-nostats",
    "-i",
    masterPath,
    "-an",
    "-vf",
    "blackdetect=d=0.5:pix_th=0.10",
    "-f",
    "null",
    "-",
  ]);
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({
    startSec: Number(m[1]),
    endSec: Number(m[2]),
  }));
  const blackTotal = black.reduce((a, b) => a + (b.endSec - b.startSec), 0);
  const longest = Math.max(0, ...black.map((b) => b.endSec - b.startSec));
  const blackFail = input.cards ? longest >= 1 : blackTotal >= durationSec * 0.9;
  checks.push({
    name: "No black picture",
    status: blackFail ? "FAIL" : blackTotal >= 2 ? "WARN" : "PASS",
    detail:
      black.length === 0
        ? "no black stretch of 0.5s or more in the whole file"
        : black
            .map((b) => `black from ${b.startSec.toFixed(1)}s to ${b.endSec.toFixed(1)}s`)
            .join("; "),
  });

  const sheetTimes: number[] = [Math.min(0.5, durationSec / 4)];
  if (input.cards) {
    const band = valueBand(format);
    const missing: string[] = [];
    for (let i = 0; i < input.cards.cards.length; i++) {
      const [a, b] = cardWindow(input.cards, i);
      // After the 0.4s ease-in, and never past the end of the file.
      const at = Math.min(durationSec - 0.1, Math.max(a + 0.6, (a + b) / 2));
      sheetTimes.push(at);
      const s = await bandStats(masterPath, at, band);
      if (s.ymax < 200) missing.push(`card ${i + 1} shows no text at ${at.toFixed(1)}s`);
    }
    checks.push({
      name: "Every card is on screen",
      status: missing.length ? "FAIL" : "PASS",
      detail: missing.length
        ? missing.join("; ")
        : `${input.cards.cards.length} cards each show their statement in their time span`,
    });
  } else {
    for (const c of lineCues.slice(0, 8)) sheetTimes.push((c.startSec + c.endSec) / 2);
  }
  sheetTimes.push(Math.max(0, durationSec - 0.5));

  const fit = captionFitProblems(displayCues, format);
  const cband = captionBand(format);
  const hidden: string[] = [];
  for (const [i, c] of displayCues.entries()) {
    if (c.endSec - c.startSec < 0.3) continue;
    const s = await bandStats(masterPath, (c.startSec + c.endSec) / 2, cband);
    if (s.ymax < 220) hidden.push(`caption ${i + 1} is not visible at ${c.startSec.toFixed(1)}s`);
  }
  checks.push({
    name: "Captions fit the safe area",
    status: fit.length ? "FAIL" : "PASS",
    detail: fit.length
      ? fit.join("; ")
      : `${displayCues.length} captions, each within ${CAPTION_STYLE[format].maxLines} lines`,
  });
  checks.push({
    name: "Captions are burned in",
    status: hidden.length ? "FAIL" : "PASS",
    detail: hidden.length
      ? hidden.join("; ")
      : "caption text is present in the picture during every caption",
  });

  const sheet = await contactSheet(masterPath, sheetTimes, format);
  return {
    report: finish(
      checks,
      {
        loudness,
        blackSec: Number(blackTotal.toFixed(2)),
        transcript: t.status === "OK" ? t.text : null,
        transcriber: t.status === "OK" ? `${t.engine} ${t.model}` : null,
        wer: cmp ? Number(cmp.wer.toFixed(3)) : null,
        lineRecall: cmp ? cmp.lines.map((l) => Number(l.recall.toFixed(2))) : null,
        contactSheetTimesSec: sheetTimes.map((x) => Number(x.toFixed(2))),
      },
      human,
    ),
    contactSheet: sheet,
    loudness,
  };
}
