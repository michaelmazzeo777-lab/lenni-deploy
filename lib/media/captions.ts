// Caption (SRT) and transcript contract, and the duration rules for renders.
// Pure functions: this checks the caption/transcript *files*. It does not prove
// that speech is audible or that captions are burned into the picture; the
// render path measures the audio and the tests inspect rendered frames.
// Adapted from the Gemini v3.1 candidate (validateCaptionAndTranscriptContract).

export type RenderFormat = "9:16" | "16:9";

/** YouTube's ceiling for a vertical or square Short (support.google.com/youtube/answer/15424877). */
export const SHORTS_PLATFORM_MAX_SEC = 180;
/** Above this length YouTube blocks a Short that carries an active Content ID claim. */
export const SHORTS_RIGHTS_SENSITIVE_SEC = 60;
/** Existing cap on a 16:9 review master. It is not a Shorts rule. */
export const LONG_FORM_MAX_SEC = 600;

/**
 * Longest clip a render may produce. 9:16 follows the Shorts platform ceiling,
 * or a stricter editorial limit (per call, or SHORTS_EDITORIAL_MAX_SEC, e.g. 58).
 * An editorial limit can only tighten the platform ceiling, never raise it.
 */
export function durationCeilingSec(
  format: RenderFormat,
  editorialMaxSec: number | undefined = envEditorialMax(),
): number {
  if (format !== "9:16") return LONG_FORM_MAX_SEC;
  if (editorialMaxSec === undefined) return SHORTS_PLATFORM_MAX_SEC;
  if (!Number.isFinite(editorialMaxSec) || editorialMaxSec <= 0) {
    throw new Error(`Invalid editorial Shorts limit: ${editorialMaxSec}`);
  }
  return Math.min(SHORTS_PLATFORM_MAX_SEC, editorialMaxSec);
}

function envEditorialMax(): number | undefined {
  const raw = process.env.SHORTS_EDITORIAL_MAX_SEC;
  return raw === undefined || raw.trim() === "" ? undefined : Number(raw);
}

export interface SrtCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export class CaptionError extends Error {}

const TIME = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/;

function parseTime(tc: string, block: number): number {
  const m = TIME.exec(tc.trim());
  if (!m) throw new CaptionError(`Caption ${block}: malformed timestamp "${tc.trim()}"`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Parses SRT text. Accepts a UTF-8 BOM and CRLF/CR line endings. */
export function parseSrt(srt: string): SrtCue[] {
  const text = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new CaptionError("Captions are empty");
  return text.split(/\n[ \t]*\n+/).map((raw, i) => {
    const n = i + 1;
    const lines = raw.split("\n").map((l) => l.trim());
    // The numeric counter line is conventional but optional.
    if (/^\d+$/.test(lines[0] ?? "")) lines.shift();
    const parts = (lines.shift() ?? "").split("-->");
    if (parts.length !== 2) throw new CaptionError(`Caption ${n}: missing "-->" timing line`);
    const startSec = parseTime(parts[0]!, n);
    const endSec = parseTime(parts[1]!, n);
    const cueText = lines.join(" ").trim();
    if (!cueText) throw new CaptionError(`Caption ${n}: no text`);
    return { index: n, startSec, endSec, text: cueText };
  });
}

/** Lower-case words only, so punctuation, case and line breaks do not matter. */
export function normalizeWords(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface CaptionContractInput {
  srt: string;
  transcript: string;
  clipDurationSec: number;
  /** Measured length of the narration audio, when known. */
  narrationDurationSec?: number;
  /** Applies the duration ceiling for that format. Omit to skip the ceiling check. */
  format?: RenderFormat;
  editorialMaxSec?: number;
}

const EPS = 0.05;

/**
 * Throws CaptionError with an actionable message, or returns a summary.
 * Checks: ceiling for the format, narration fits the clip, cues parse, each has
 * positive length, cues are ordered and do not overlap, none ends after the
 * clip, and every cue's words appear in the transcript in order.
 */
export function validateCaptionContract(input: CaptionContractInput): {
  cueCount: number;
  lastCueEndSec: number;
} {
  const { clipDurationSec } = input;
  if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) {
    throw new CaptionError(`Clip duration must be positive (got ${clipDurationSec})`);
  }
  if (input.format) {
    const ceiling = durationCeilingSec(input.format, input.editorialMaxSec);
    if (clipDurationSec > ceiling + EPS) {
      throw new CaptionError(
        `Clip is ${clipDurationSec.toFixed(1)}s; the limit for ${input.format} is ${ceiling}s`,
      );
    }
  }
  if (
    input.narrationDurationSec !== undefined &&
    input.narrationDurationSec > clipDurationSec + EPS
  ) {
    throw new CaptionError(
      `Narration (${input.narrationDurationSec.toFixed(1)}s) is longer than the clip (${clipDurationSec.toFixed(1)}s)`,
    );
  }
  const cues = parseSrt(input.srt);
  const transcript = ` ${normalizeWords(input.transcript)} `;
  let prevEnd = 0;
  let searchFrom = 0;
  for (const c of cues) {
    if (c.endSec <= c.startSec) {
      throw new CaptionError(`Caption ${c.index}: ends at or before it starts`);
    }
    if (c.startSec < prevEnd - EPS) {
      throw new CaptionError(`Caption ${c.index}: starts before the previous caption ends`);
    }
    if (c.endSec > clipDurationSec + EPS) {
      throw new CaptionError(
        `Caption ${c.index}: ends at ${c.endSec.toFixed(2)}s, after the ${clipDurationSec.toFixed(2)}s clip`,
      );
    }
    const words = normalizeWords(c.text);
    if (!words) throw new CaptionError(`Caption ${c.index}: no words`);
    const at = transcript.indexOf(` ${words} `, searchFrom);
    if (at < 0) {
      throw new CaptionError(
        `Caption ${c.index}: "${c.text}" is not in the transcript (or is out of order)`,
      );
    }
    searchFrom = at + words.length;
    prevEnd = c.endSec;
  }
  return { cueCount: cues.length, lastCueEndSec: prevEnd };
}

// ---- On-screen caption geometry -------------------------------------------
// Captions are burned in by the compositor. These numbers are the single
// source for where they go, how much text one caption may hold, and which
// pixels QA inspects. 9:16 keeps captions above the bottom interface zone of
// a Shorts player and clear of the buttons down its right edge.

export interface CaptionStyle {
  size: number;
  marginV: number; // distance of the caption block's bottom edge from the frame bottom
  marginH: number; // left and right margin
  maxLines: number;
  frameW: number;
  frameH: number;
}

export const CAPTION_STYLE: Record<RenderFormat, CaptionStyle> = {
  "16:9": { size: 54, marginV: 70, marginH: 70, maxLines: 2, frameW: 1920, frameH: 1080 },
  "9:16": { size: 64, marginV: 430, marginH: 120, maxLines: 3, frameW: 1080, frameH: 1920 },
};

/** Characters that fit on one caption line (bold Helvetica Neue, generous advance). */
export function captionCharsPerLine(format: RenderFormat): number {
  const s = CAPTION_STYLE[format];
  return Math.floor((s.frameW - 2 * s.marginH) / (s.size * 0.6));
}

/** Most characters a single on-screen caption may carry. */
export const captionMaxChars = (format: RenderFormat) =>
  captionCharsPerLine(format) * CAPTION_STYLE[format].maxLines - 4;

/** Lines a caption will occupy when wrapped at word boundaries. */
export function captionLineCount(text: string, format: RenderFormat): number {
  const max = captionCharsPerLine(format);
  let lines = 0;
  let cur = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (cur > 0 && cur + 1 + word.length > max) {
      lines++;
      cur = word.length;
    } else cur = cur > 0 ? cur + 1 + word.length : word.length;
    if (word.length > max) lines += Math.ceil(word.length / max) - 1;
  }
  return cur > 0 ? lines + 1 : lines;
}

/** Centre strip of the caption block: captions are centred, the attribution line is not. */
export function captionBand(format: RenderFormat): { x: number; y: number; w: number; h: number } {
  const s = CAPTION_STYLE[format];
  const h = Math.round(s.size * 1.25 * s.maxLines) + 20;
  return { x: s.frameW / 2 - 200, y: s.frameH - s.marginV - h + 10, w: 400, h };
}

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Splits narration lines that are too long for one on-screen caption into
 * consecutive captions, breaking at punctuation where possible. A piece gets
 * the share of its line's time that matches its share of the characters. The
 * first piece keeps the line's start, so line-level sync is unchanged.
 */
export function chunkCues(cues: Cue[], format: RenderFormat): Cue[] {
  const max = captionMaxChars(format);
  const out: Cue[] = [];
  for (const cue of cues) {
    const text = cue.text.trim().replace(/\s+/g, " ");
    if (text.length <= max) {
      out.push({ ...cue, text });
      continue;
    }
    const pieces = splitBalanced(text.split(" "), max);
    const total = pieces.reduce((a, p) => a + p.length, 0);
    let t = cue.startSec;
    for (const [i, piece] of pieces.entries()) {
      const end =
        i === pieces.length - 1
          ? cue.endSec
          : t + ((cue.endSec - cue.startSec) * piece.length) / total;
      out.push({ startSec: t, endSec: end, text: piece });
      t = end;
    }
  }
  return out;
}

/**
 * Splits words into the fewest pieces that each fit `max` characters, aiming
 * for pieces of similar length and preferring to break after punctuation, so
 * a caption never ends with one stranded word.
 */
function splitBalanced(words: string[], max: number): string[] {
  const text = words.join(" ");
  if (text.length <= max || words.length < 2) return [text];
  const target = text.length / Math.ceil(text.length / max);
  let best = 1;
  let bestCost = Infinity;
  let len = 0;
  for (let i = 1; i < words.length; i++) {
    len += words[i - 1]!.length + (i > 1 ? 1 : 0);
    if (len > max) break;
    const cost = Math.abs(len - target) - (/[,.;:!?]$/.test(words[i - 1]!) ? target * 0.35 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), ...splitBalanced(words.slice(best), max)];
}
