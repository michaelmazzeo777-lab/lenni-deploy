import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "@/lib/media/ffmpeg";

// Original synthetic test clips (ffmpeg lavfi sources only - no game footage,
// no third-party media). Every frame is burned with a fixture label so a clip
// can never be mistaken for gameplay. Segment kinds have known ground truth:
//   action / quietAction  -> labeled highlight windows
//   loudMenu              -> loud audio over a still frame (false-positive bait)
//   calm / black          -> non-highlights

export type SegmentKind = "calm" | "action" | "quietAction" | "loudMenu" | "black";
export interface FixtureSpec {
  name: string;
  segments: { kind: SegmentKind; sec: number }[];
}

export const FIXTURES: FixtureSpec[] = [
  {
    name: "fixture_a_loud_and_quiet_action.mp4",
    segments: [
      { kind: "calm", sec: 12 },
      { kind: "action", sec: 8 },
      { kind: "calm", sec: 14 },
      { kind: "black", sec: 4 },
      { kind: "quietAction", sec: 8 },
      { kind: "calm", sec: 14 },
    ],
  },
  {
    name: "fixture_b_loud_menu_bait.mp4",
    segments: [
      { kind: "loudMenu", sec: 8 },
      { kind: "calm", sec: 12 },
      { kind: "action", sec: 6 },
      { kind: "calm", sec: 14 },
      { kind: "action", sec: 10 },
      { kind: "black", sec: 4 },
      { kind: "calm", sec: 6 },
    ],
  },
  {
    name: "fixture_c_quiet_first.mp4",
    segments: [
      { kind: "calm", sec: 15 },
      { kind: "quietAction", sec: 8 },
      { kind: "calm", sec: 12 },
      { kind: "loudMenu", sec: 6 },
      { kind: "calm", sec: 11 },
      { kind: "action", sec: 8 },
      { kind: "calm", sec: 15 },
    ],
  },
];

export function truthWindows(spec: FixtureSpec): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  let t = 0;
  for (const s of spec.segments) {
    if (s.kind === "action" || s.kind === "quietAction") {
      out.push({ startSec: t, endSec: t + s.sec });
    }
    t += s.sec;
  }
  return out;
}

const SIZE = "1280x720";
const VIDEO: Record<SegmentKind, string> = {
  calm: `gradients=size=${SIZE}:rate=30:speed=0.004:seed=7`,
  action: `life=size=320x180:rate=30:seed=3:ratio=0.35:mold=8:life_color=0xffcc33:death_color=0x102040,scale=${SIZE}:flags=neighbor`,
  quietAction: `life=size=320x180:rate=30:seed=9:ratio=0.3:mold=6:life_color=0x33ddff:death_color=0x201030,scale=${SIZE}:flags=neighbor`,
  loudMenu: `color=c=0x24303c:size=${SIZE}:rate=30`,
  black: `color=c=black:size=${SIZE}:rate=30`,
};
const AUDIO: Record<SegmentKind, string> = {
  calm: "anoisesrc=color=pink:amplitude=0.012:seed=1:sample_rate=48000",
  action: "anoisesrc=color=brown:amplitude=0.7:seed=2:sample_rate=48000",
  quietAction: "anoisesrc=color=pink:amplitude=0.012:seed=4:sample_rate=48000",
  loudMenu: "anoisesrc=color=brown:amplitude=0.7:seed=5:sample_rate=48000",
  black: "anullsrc=sample_rate=48000:channel_layout=mono",
};

// Renders one fixture. `scale` < 1 shortens every segment (fast test clips).
export async function makeFixture(spec: FixtureSpec, outPath: string, scale = 1): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const args: string[] = [];
  spec.segments.forEach((s) => {
    const d = String(s.sec * scale);
    args.push(
      "-f",
      "lavfi",
      "-t",
      d,
      "-i",
      VIDEO[s.kind],
      "-f",
      "lavfi",
      "-t",
      d,
      "-i",
      AUDIO[s.kind],
    );
  });
  const n = spec.segments.length;
  const pairs = spec.segments.map((_, i) => `[${2 * i}:v]format=yuv420p[v${i}];`).join("");
  const refs = spec.segments.map((_, i) => `[v${i}][${2 * i + 1}:a]`).join("");
  const label =
    "drawtext=text='SYNTHETIC TEST FIXTURE - NOT GAMEPLAY':fontcolor=white:fontsize=30:" +
    "box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=24";
  args.push(
    "-filter_complex",
    `${pairs}${refs}concat=n=${n}:v=1:a=1[cv][ca];[cv]${label}[v]`,
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

// Writes all fixtures plus their ground-truth labels into `dir`.
export async function makeAllFixtures(dir: string): Promise<void> {
  for (const spec of FIXTURES) await makeFixture(spec, path.join(dir, spec.name));
  const labels = Object.fromEntries(FIXTURES.map((f) => [f.name, truthWindows(f)]));
  await writeFile(
    path.join(dir, "fixtures.labels.json"),
    JSON.stringify(
      { note: "Synthetic fixtures. Ground truth = generated action segments.", labels },
      null,
      2,
    ),
  );
}
