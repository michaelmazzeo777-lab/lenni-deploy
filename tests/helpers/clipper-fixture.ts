// Builds a ~10-minute labelled fixture for the long-session clipper's
// acceptance test (A1): 5 planted events at known times - two loud bursts, a
// rapid-cut flicker, a quiet-but-visually-busy burst and a spoken line - each
// a few seconds long inside otherwise calm footage. Original synthetic
// sources only (ffmpeg lavfi, macOS `say`); no game footage. Separate from
// tests/helpers/fixtures.ts's short labelled clips (highlight-benchmark):
// those don't carry speech, which this run's A3 (no mid-word cuts) needs.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDurationSec, run } from "@/lib/media/ffmpeg";
import { AUDIO, VIDEO, type SegmentKind } from "./fixtures";

export interface PlantedEvent {
  name: string;
  atSec: number;
  startSec: number;
  endSec: number;
}

/** `event` names the one planted moment this segment belongs to; a run of
 * segments sharing the same name (the rapid-cut flicker) is one event
 * spanning all of them. */
type Seg = { kind: SegmentKind; sec: number; audioFile?: string; event?: string };

const CALM: SegmentKind = "calm";
const GAP = 110;
const HEAD_TAIL = 60;
const SPEECH_TEXT = "nice shot that was incredible right there";

async function makeSpeechClip(dir: string): Promise<{ wav: string; durationSec: number }> {
  const aiff = path.join(dir, "speech.aiff");
  await run("say", ["-o", aiff, "--", SPEECH_TEXT]);
  const wav = path.join(dir, "speech.wav");
  await ffmpeg(["-i", aiff, "-ar", "48000", "-ac", "1", wav]);
  return { wav, durationSec: await probeDurationSec(wav) };
}

async function render(segments: Seg[], outPath: string): Promise<void> {
  const args: string[] = [];
  segments.forEach((s) => {
    const d = String(s.sec);
    args.push("-f", "lavfi", "-t", d, "-i", VIDEO[s.kind]);
    if (s.audioFile) args.push("-i", s.audioFile);
    else args.push("-f", "lavfi", "-t", d, "-i", AUDIO[s.kind]);
  });
  const n = segments.length;
  const videoPairs = segments.map((_, i) => `[${2 * i}:v]format=yuv420p[v${i}];`).join("");
  const audioPairs = segments
    .map((_, i) => `[${2 * i + 1}:a]aformat=sample_rates=48000:channel_layouts=mono[a${i}];`)
    .join("");
  const refs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  const label =
    "drawtext=text='SYNTHETIC TEST FIXTURE - NOT GAMEPLAY':fontcolor=white:fontsize=30:" +
    "box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=24";
  args.push(
    "-filter_complex",
    `${videoPairs}${audioPairs}${refs}concat=n=${n}:v=1:a=1[cv][ca];[cv]${label}[v]`,
    "-map",
    "[v]",
    "-map",
    "[ca]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outPath,
  );
  await ffmpeg(args);
}

/** Renders the fixture and returns its planted events' ground truth. */
export async function makeClipperFixture(
  outPath: string,
  workDir: string,
): Promise<PlantedEvent[]> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(workDir, { recursive: true });
  const speech = await makeSpeechClip(workDir);

  const segments: Seg[] = [
    { kind: CALM, sec: HEAD_TAIL },
    { kind: "action", sec: 2, event: "loud burst A" },
    { kind: CALM, sec: GAP },
    { kind: "quietAction", sec: 2, event: "quiet but visually busy" },
    { kind: CALM, sec: GAP },
    { kind: "action", sec: 0.4, event: "rapid cuts" },
    { kind: "loudMenu", sec: 0.4, event: "rapid cuts" },
    { kind: "action", sec: 0.4, event: "rapid cuts" },
    { kind: "loudMenu", sec: 0.4, event: "rapid cuts" },
    { kind: "action", sec: 0.4, event: "rapid cuts" },
    { kind: CALM, sec: GAP },
    { kind: CALM, sec: speech.durationSec, audioFile: speech.wav, event: "spoken line" },
    { kind: CALM, sec: GAP },
    { kind: "action", sec: 2, event: "loud burst B" },
    { kind: CALM, sec: HEAD_TAIL },
  ];
  await render(segments, outPath);

  const events = new Map<string, PlantedEvent>();
  let t = 0;
  for (const s of segments) {
    const start = t;
    const end = t + s.sec;
    if (s.event) {
      const existing = events.get(s.event);
      const windowStart = existing ? existing.startSec : start;
      events.set(s.event, {
        name: s.event,
        startSec: windowStart,
        endSec: end,
        atSec: (windowStart + end) / 2,
      });
    }
    t = end;
  }
  return [...events.values()].sort((a, b) => a.startSec - b.startSec);
}
