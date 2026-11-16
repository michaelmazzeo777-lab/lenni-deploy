// Compares what was said (a transcript with word times) with what the script
// says, and derives caption timing from it. Pure functions.

export interface TimedWord {
  text: string;
  startSec: number;
  endSec: number;
}

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const ORDINAL: Record<string, string> = {
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
};

/**
 * Words as they would be compared by ear: lower case, no punctuation, "&" as
 * "and", ordinals and small number words as digits ("15th" = "15" = "fifteen").
 */
export function spokenWords(text: string): string[] {
  const raw = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    const ord = /^(\d+)(st|nd|rd|th)$/.exec(w);
    if (ord) out.push(ord[1]!);
    else if (w in ORDINAL) out.push(ORDINAL[w]!);
    else if (w in TENS) {
      const next = raw[i + 1];
      if (next !== undefined && next in SMALL && SMALL[next]! > 0 && SMALL[next]! < 10) {
        out.push(String(TENS[w]! + SMALL[next]!));
        i++;
      } else out.push(String(TENS[w]));
    } else if (w in SMALL) out.push(String(SMALL[w]));
    else out.push(w);
  }
  // Letters spoken one by one ("X|S", "P S 5") are heard as one token ("XS").
  const merged: string[] = [];
  for (const w of out) {
    const prev = merged[merged.length - 1];
    const letter = (x: string) => /^[b-hj-z]$/.test(x);
    if (prev !== undefined && letter(w) && /^[b-hj-z]+$/.test(prev) && prev.length < 4) {
      merged[merged.length - 1] = prev + w;
    } else merged.push(w);
  }
  return merged;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Same word, allowing one slip in a long word (a transcriber's spelling of a name). */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  return editDistance(a, b, n >= 9 ? 2 : 1) <= (n >= 9 ? 2 : 1);
}

export interface Alignment {
  /** For each reference word: index of the heard word it matched, or -1. */
  map: number[];
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Word error rate against the reference. */
  wer: number;
  /** Reference words that were not heard as written: [expected, heard or ""]. */
  mismatches: [string, string][];
}

/**
 * Minimum-edit alignment of the script's words to the heard words. A compound
 * heard as two words ("gameplay" / "game play"), or the reverse, is a match.
 */
export function alignWords(ref: string[], hyp: string[]): Alignment {
  const n = ref.length;
  const m = hyp.length;
  const INF = Number.POSITIVE_INFINITY;
  const sub = (i: number, j: number) => (sameWord(ref[i - 1]!, hyp[j - 1]!) ? 0 : 1);
  // hyp[j-2] + hyp[j-1] read together is ref[i-1]
  const joinHyp = (i: number, j: number) =>
    j >= 2 &&
    sameWord(ref[i - 1]!, hyp[j - 2]! + hyp[j - 1]!) &&
    !sameWord(ref[i - 1]!, hyp[j - 1]!);
  // ref[i-2] + ref[i-1] read together is hyp[j-1]
  const joinRef = (i: number, j: number) =>
    i >= 2 &&
    sameWord(ref[i - 2]! + ref[i - 1]!, hyp[j - 1]!) &&
    !sameWord(ref[i - 1]!, hyp[j - 1]!);
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + sub(i, j),
        joinHyp(i, j) ? d[i - 1]![j - 2]! : INF,
        joinRef(i, j) ? d[i - 2]![j - 1]! : INF,
      );
    }
  }
  const map = new Array<number>(n).fill(-1);
  const mismatches: [string, string][] = [];
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && joinHyp(i, j) && d[i]![j] === d[i - 1]![j - 2]!) {
      map[i - 1] = j - 2;
      i--;
      j -= 2;
    } else if (i > 0 && j > 0 && joinRef(i, j) && d[i]![j] === d[i - 2]![j - 1]!) {
      map[i - 1] = j - 1;
      map[i - 2] = j - 1;
      i -= 2;
      j--;
    } else if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + sub(i, j)) {
      if (sub(i, j) === 0) map[i - 1] = j - 1;
      else {
        substitutions++;
        mismatches.unshift([ref[i - 1]!, hyp[j - 1]!]);
      }
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deletions++;
      mismatches.unshift([ref[i - 1]!, ""]);
      i--;
    } else {
      insertions++;
      j--;
    }
  }
  return {
    map,
    substitutions,
    deletions,
    insertions,
    wer: n === 0 ? (m === 0 ? 0 : 1) : (substitutions + deletions + insertions) / n,
    mismatches,
  };
}

export interface LineReport {
  line: number; // 1-based
  words: number;
  matched: number;
  recall: number;
  /** Time of the first and last matched word, when any word matched. */
  startSec: number | null;
  endSec: number | null;
  /**
   * End of the first matched word. A transcriber often stretches a word's
   * start back over the pause before it, so the true onset lies somewhere
   * between startSec and here.
   */
  firstWordEndSec: number | null;
}

export interface ScriptComparison {
  wer: number;
  lines: LineReport[];
  mismatches: [string, string][];
  heardText: string;
}

/** Script lines against a timed transcript: overall error rate and a per-line account. */
export function compareScript(lines: string[], heard: TimedWord[]): ScriptComparison {
  const ref: string[] = [];
  const owner: number[] = [];
  lines.forEach((line, li) => {
    for (const w of spokenWords(line)) {
      ref.push(w);
      owner.push(li);
    }
  });
  // One heard token can normalize to several words ("twenty-six"); keep its time on each.
  const hyp: string[] = [];
  const hypTime: TimedWord[] = [];
  for (const h of heard) {
    for (const w of spokenWords(h.text)) {
      hyp.push(w);
      hypTime.push(h);
    }
  }
  const a = alignWords(ref, hyp);
  const report: LineReport[] = lines.map((_, li) => ({
    line: li + 1,
    words: 0,
    matched: 0,
    recall: 0,
    startSec: null,
    endSec: null,
    firstWordEndSec: null,
  }));
  ref.forEach((_, ri) => {
    const r = report[owner[ri]!]!;
    r.words++;
    const hi = a.map[ri]!;
    if (hi >= 0) {
      r.matched++;
      const t = hypTime[hi]!;
      if (r.startSec === null) {
        r.startSec = t.startSec;
        r.firstWordEndSec = t.endSec;
      }
      r.endSec = t.endSec;
    }
  });
  for (const r of report) r.recall = r.words === 0 ? 0 : r.matched / r.words;
  return {
    wer: a.wer,
    lines: report,
    mismatches: a.mismatches,
    heardText: heard
      .map((h) => h.text.trim())
      .filter(Boolean)
      .join(" "),
  };
}

export const MAX_WER = 0.15;
export const MIN_LINE_RECALL = 0.7;

/** Empty when the transcript supports the script; otherwise what is wrong. */
export function scriptProblems(c: ScriptComparison, maxWer: number | null = MAX_WER): string[] {
  const out: string[] = [];
  for (const l of c.lines) {
    if (l.recall < MIN_LINE_RECALL) {
      out.push(
        `Line ${l.line}: only ${l.matched} of ${l.words} words were heard${
          l.startSec === null ? " (line missing)" : ` (around ${l.startSec.toFixed(1)}s)`
        }`,
      );
    }
  }
  if (maxWer !== null && c.wer > maxWer) {
    out.push(`Word error rate ${(c.wer * 100).toFixed(0)}% exceeds ${(maxWer * 100).toFixed(0)}%`);
  }
  return out;
}

export interface SilenceSpan {
  startSec: number;
  endSec: number;
}

/**
 * Where a line really starts. A transcriber's word times are coarse around
 * pauses: the first word after a pause is often reported inside the silence
 * before it. So: if the reported start falls in a silence, the line starts
 * when that silence ends; otherwise a speech onset within 0.35s wins;
 * otherwise the reported time stands (continuous speech has no pause to use).
 */
export function lineOnset(reportedStartSec: number, silences: SilenceSpan[]): number {
  const inside = silences.find(
    (s) => s.startSec <= reportedStartSec + 0.05 && reportedStartSec <= s.endSec,
  );
  if (inside) return inside.endSec;
  const near = silences
    .map((s) => s.endSec)
    .filter((o) => Math.abs(o - reportedStartSec) <= 0.35)
    .sort((a, b) => Math.abs(a - reportedStartSec) - Math.abs(b - reportedStartSec))[0];
  return near ?? reportedStartSec;
}

/**
 * Caption timing for a recording, from where each line's words were heard,
 * corrected to the real speech onsets (see lineOnset). Lines that were not
 * heard get the gap between their neighbours. Returns null if nothing matched.
 */
export function cuesFromComparison(
  lines: string[],
  c: ScriptComparison,
  durationSec: number,
  silences: SilenceSpan[] = [],
): { startSec: number; endSec: number; text: string }[] | null {
  if (!c.lines.some((l) => l.startSec !== null)) return null;
  const starts = c.lines.map((l) => l.startSec);
  const ends = c.lines.map((l) => l.endSec);
  for (let i = 0; i < lines.length; i++) {
    if (starts[i] !== null) continue;
    const prevEnd = i > 0 ? (ends[i - 1] ?? 0) : 0;
    let next = durationSec;
    for (let k = i + 1; k < lines.length; k++) {
      if (starts[k] !== null) {
        next = starts[k]!;
        break;
      }
    }
    starts[i] = prevEnd;
    ends[i] = Math.max(prevEnd, next);
  }
  const cues = lines.map((text, i) => {
    const heard = c.lines[i]!.startSec !== null;
    const s = heard ? lineOnset(starts[i]!, silences) : starts[i]!;
    return { startSec: s, endSec: Math.max(ends[i]!, s + 0.2), text };
  });
  // Keep cues ordered and non-overlapping.
  for (let i = 0; i < cues.length; i++) {
    const prev = cues[i - 1];
    if (prev && cues[i]!.startSec < prev.endSec) {
      const mid = Math.max(prev.startSec + 0.1, Math.min(prev.endSec, cues[i]!.startSec));
      prev.endSec = mid;
      cues[i]!.startSec = mid;
    }
    cues[i]!.endSec = Math.min(durationSec, Math.max(cues[i]!.endSec, cues[i]!.startSec + 0.1));
  }
  return cues;
}
