// Builds burned-in captions for one clip from the shortlisted window's word
// timestamps: groups words into on-screen cues (pause-based), then an .ass
// subtitle file in the same geometry as the rest of the Studio's renders
// (lib/media/captions.ts CAPTION_STYLE) so QA's safe-area checks apply
// unchanged. Separate from lib/shorts/local-providers.ts's buildAss: that one
// carries narration attribution and a fixture label that do not apply to a
// raw session clip.
import type { TimedWord } from "@/lib/media/align";
import { CAPTION_STYLE, chunkCues, type Cue, type RenderFormat } from "@/lib/media/captions";

const WORD_GAP_SEC = 0.6;
const MAX_WORDS_PER_CUE = 7;

/**
 * Groups a window's words into on-screen caption cues, clipped to and
 * made relative to [clipStartSec, clipEndSec). A new cue starts after a
 * pause of WORD_GAP_SEC or once a cue reaches MAX_WORDS_PER_CUE words.
 */
export function wordsToCues(words: TimedWord[], clipStartSec: number, clipEndSec: number): Cue[] {
  const rel = words
    .filter((w) => w.endSec > clipStartSec && w.startSec < clipEndSec)
    .map((w) => ({
      text: w.text,
      startSec: Math.max(0, w.startSec - clipStartSec),
      endSec: Math.min(clipEndSec - clipStartSec, w.endSec - clipStartSec),
    }))
    .filter((w) => w.endSec > w.startSec);

  const cues: Cue[] = [];
  let cur: Cue | null = null;
  let count = 0;
  for (const w of rel) {
    if (cur && w.startSec - cur.endSec < WORD_GAP_SEC && count < MAX_WORDS_PER_CUE) {
      cur.text += ` ${w.text}`;
      cur.endSec = w.endSec;
      count++;
    } else {
      if (cur) cues.push(cur);
      cur = { ...w };
      count = 1;
    }
  }
  if (cur) cues.push(cur);
  return cues;
}

const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
const assText = (s: string) => s.replace(/[{}\\]/g, "").replace(/\s*\n\s*/g, " ");

export const DRAFT_LABEL = "LEONIDA FIELD GUIDE · DRAFT · PENDING MIKE REVIEW";

/** One clip's burned captions and draft label, in CAPTION_STYLE geometry. */
export function buildClipAss(opts: {
  format: RenderFormat;
  durationSec: number;
  cues: Cue[];
}): string {
  const { frameW, frameH, size, marginH, marginV } = CAPTION_STYLE[opts.format];
  const end = assTime(opts.durationSec);
  const displayCues = chunkCues(opts.cues, opts.format);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frameW}`,
    `PlayResY: ${frameH}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Caption,Helvetica Neue,${size},&H00FFFFFF,&H00000000,&H80000000,1,1,5,1,2,${marginH},${marginH},${marginV}`,
    "Style: Draft,Helvetica Neue,28,&H00FFFFFF,&H00000000,&H80000000,0,1,2,0,1,30,30,30",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    `Dialogue: 0,0:00:00.00,${end},Draft,${assText(DRAFT_LABEL)}`,
  ];
  for (const c of displayCues) {
    if (c.startSec >= opts.durationSec) continue;
    lines.push(
      `Dialogue: 1,${assTime(c.startSec)},${assTime(Math.min(c.endSec, opts.durationSec))},Caption,${assText(c.text)}`,
    );
  }
  return lines.join("\n") + "\n";
}
