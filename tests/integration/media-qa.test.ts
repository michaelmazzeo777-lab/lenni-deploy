import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, probeDurationSec, run } from "@/lib/media/ffmpeg";
import {
  LOUDNESS_TARGET_LUFS,
  clippingStats,
  detectSilences,
  loudnessProblems,
  measureLoudness,
  speechOnsets,
} from "@/lib/media/audio-qa";
import { LISTENING_REQUIRED, bandStats, narrationQa, renderQa } from "@/lib/media/qa";
import { transcribe, transcriberConfig } from "@/lib/media/transcribe";
import { chunkCues, type Cue } from "@/lib/media/captions";
import {
  LocalFfmpegCompositorProvider,
  LocalSayFixtureTTSProvider,
  OperatorRecordingProvider,
} from "@/lib/shorts/local-providers";

// Narration and render QA against real audio and video made on this machine
// (macOS `say`, ffmpeg, and the local whisper.cpp model). Nothing here is a
// mock: every assertion is about a file that was actually produced.

const HAS_MODEL = !("missing" in transcriberConfig());
const LINES = [
  "This narration is a test of the quality checks.",
  "The second sentence follows after a short pause.",
  "The third sentence closes the recording.",
];
const CARDS = LINES.map((_, i) => ({
  label: `CARD ${i + 1}`,
  value: `STATEMENT ${i + 1}`,
  note: "Test card",
}));
let dir = "";
let wav = "";
let cues: Cue[] = [];

const check = (r: { checks: { name: string; status: string; detail: string }[] }, name: string) =>
  r.checks.find((c) => c.name === name)!;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "media-qa-"));
  const vo = await new LocalSayFixtureTTSProvider().synthesize({
    scriptText: LINES.join(" "),
    voiceProfileId: "default",
    segments: LINES,
  });
  wav = path.join(dir, "vo.wav");
  await writeFile(wav, vo.audioBytes);
  cues = vo.cues!;
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("transcription", () => {
  it("has the local speech model available (otherwise the checks below are not real)", () => {
    expect(HAS_MODEL).toBe(true);
  });

  it("transcribes real speech with a time for every word", async () => {
    const t = await transcribe(wav);
    expect(t.status).toBe("OK");
    if (t.status !== "OK") return;
    expect(t.text.toLowerCase()).toContain("quality checks");
    expect(t.words.length).toBeGreaterThan(15);
    expect(t.words.every((w) => w.endSec >= w.startSec)).toBe(true);
    expect(t.model).toMatch(/^ggml-.*\.bin$/);
  }, 60_000);

  it("answers NOT_VERIFIED - never a pass - when the model is missing", async () => {
    const saved = process.env.WHISPER_MODEL_PATH;
    process.env.WHISPER_MODEL_PATH = path.join(dir, "no-such-model.bin");
    try {
      const t = await transcribe(wav);
      expect(t).toEqual({
        status: "NOT_VERIFIED",
        reason: expect.stringMatching(/model not found/),
      });
      const qa = await narrationQa({ wavPath: wav, lines: LINES, cues, cueTiming: "EXACT" });
      expect(check(qa, "Speech matches script").status).toBe("NOT_VERIFIED");
      expect(qa.verified).toBe(false);
      expect(qa.humanValidation.join(" ")).toContain(LISTENING_REQUIRED);
    } finally {
      process.env.WHISPER_MODEL_PATH = saved;
    }
  }, 60_000);
});

describe("narration QA on real audio", () => {
  it("passes a clean narration: speech matches the script, captions start with the speech", async () => {
    const qa = await narrationQa({ wavPath: wav, lines: LINES, cues, cueTiming: "EXACT" });
    expect(qa.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    expect(qa.passed && qa.verified).toBe(true);
    expect(check(qa, "Speech matches script").detail).toMatch(
      /word error rate \d+%, every line heard/,
    );
    expect(qa.measurements.wer).toBeLessThanOrEqual(0.15);
    // Every caption starts within 0.35s of where sound actually begins.
    const onsets = speechOnsets(
      await detectSilences(wav, await probeDurationSec(wav), { minSec: 0.15 }),
      999,
    );
    for (const c of cues) {
      expect(Math.min(...onsets.map((o) => Math.abs(o - c.startSec)))).toBeLessThanOrEqual(0.35);
    }
  }, 90_000);

  it("fails when the script and the speech differ: a wrong sentence, and a missing one", async () => {
    const wrong = [
      LINES[0]!,
      "Completely different words were written in this line instead.",
      LINES[2]!,
    ];
    const a = await narrationQa({ wavPath: wav, lines: wrong, cues, cueTiming: "EXACT" });
    expect(a.passed).toBe(false);
    expect(check(a, "Speech matches script").detail).toMatch(
      /Line 2: only \d of \d+ words were heard/,
    );

    const extra = [...LINES, "A fourth sentence that nobody recorded."];
    const b = await narrationQa({
      wavPath: wav,
      lines: extra,
      cues: [
        ...cues,
        { startSec: cues[2]!.endSec, endSec: cues[2]!.endSec + 0.1, text: extra[3]! },
      ],
      cueTiming: "EXACT",
    });
    expect(check(b, "Speech matches script").detail).toMatch(
      /Line 4: only [01] of \d+ words were heard/,
    );
  }, 90_000);

  it("fails captions that are shifted away from the speech", async () => {
    const shifted = cues.map((c) => ({ ...c, startSec: c.startSec + 1.2, endSec: c.endSec + 1.2 }));
    const qa = await narrationQa({ wavPath: wav, lines: LINES, cues: shifted, cueTiming: "EXACT" });
    expect(check(qa, "Captions start with the speech").status).toBe("FAIL");
    expect(check(qa, "Captions start with the speech").detail).toMatch(
      /caption 1 starts at 1\.20s/,
    );
    expect(check(qa, "Captions follow the transcript").status).toBe("FAIL");
  }, 90_000);

  it("fails dead air inside a line, naming where", async () => {
    // Insert three seconds of silence in the middle of line 2.
    const mid = (cues[1]!.startSec + cues[1]!.endSec) / 2;
    const gapped = path.join(dir, "gapped.wav");
    await ffmpeg([
      "-i",
      wav,
      "-filter_complex",
      `[0:a]atrim=0:${mid},asetpts=PTS-STARTPTS[a];anullsrc=r=48000:cl=mono,atrim=0:3[s];` +
        `[0:a]atrim=${mid},asetpts=PTS-STARTPTS[b];[a][s][b]concat=n=3:v=0:a=1[o]`,
      "-map",
      "[o]",
      gapped,
    ]);
    const moved = cues.map((c, i) =>
      i === 1
        ? { ...c, endSec: c.endSec + 3 }
        : i === 2
          ? { ...c, startSec: c.startSec + 3, endSec: c.endSec + 3 }
          : c,
    );
    const qa = await narrationQa({
      wavPath: gapped,
      lines: LINES,
      cues: moved,
      cueTiming: "EXACT",
    });
    const c = check(qa, "No dead air inside a line");
    expect(c.status).toBe("FAIL");
    expect(c.detail).toMatch(/3\.\ds of silence inside line 2 at \d+\.\ds/);
  }, 90_000);

  it("fails a narration that is cut off mid-word, and one that is clipped", async () => {
    const cut = path.join(dir, "cut.wav");
    await ffmpeg(["-i", wav, "-t", String(cues[1]!.startSec + 0.9), cut]);
    const a = await narrationQa({
      wavPath: cut,
      lines: LINES.slice(0, 2),
      cues: cues.slice(0, 2),
      cueTiming: "EXACT",
    });
    expect(check(a, "Ends cleanly").status).toBe("FAIL");
    expect(check(a, "Ends cleanly").detail).toMatch(/possibly cut off mid-word/);

    const clipped = path.join(dir, "clipped.wav");
    await ffmpeg(["-i", wav, "-af", "volume=30dB", "-c:a", "pcm_s16le", clipped]);
    expect((await clippingStats(clipped)).clipped).toBe(true);
    expect((await clippingStats(wav)).clipped).toBe(false);
    const b = await narrationQa({ wavPath: clipped, lines: LINES, cues, cueTiming: "EXACT" });
    expect(check(b, "No clipping").status).toBe("FAIL");
    expect(b.passed).toBe(false);
  }, 90_000);
});

describe("recorded narration gets its caption times from the speech", () => {
  it.skipIf(!HAS_MODEL)(
    "aligns captions to an unevenly paced recording within 0.35s of each line's real start",
    async () => {
      // A "recording": the three lines at a slower rate with uneven pauses, so
      // spreading captions by text length would be wrong.
      const ingest = path.join(dir, "ingest");
      await mkdir(ingest, { recursive: true });
      const pauses = [0.4, 2.2, 0.7];
      const parts: string[] = [];
      const truth: number[] = [];
      let t = 0;
      for (const [i, line] of LINES.entries()) {
        const raw = path.join(dir, `r${i}.aiff`);
        const seg = path.join(dir, `r${i}.wav`);
        await run("say", ["-r", "150", "-o", raw, "--", line]);
        await ffmpeg([
          "-i",
          raw,
          "-af",
          "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB",
          "-ar",
          "48000",
          seg,
        ]);
        t += pauses[i]!;
        truth.push(t);
        t += await probeDurationSec(seg);
        parts.push(
          `anullsrc=r=48000:cl=mono,atrim=0:${pauses[i]}[s${i}];[${i}:a]aresample=48000[p${i}]`,
        );
      }
      const inputs = LINES.flatMap((_, i) => ["-i", path.join(dir, `r${i}.wav`)]);
      await ffmpeg([
        ...inputs,
        "-filter_complex",
        `${parts.join(";")};${LINES.map((_, i) => `[s${i}][p${i}]`).join("")}concat=n=${LINES.length * 2}:v=0:a=1[o]`,
        "-map",
        "[o]",
        path.join(ingest, "narration.wav"),
      ]);

      const saved = process.env.CAPTURE_INGEST_DIR;
      process.env.CAPTURE_INGEST_DIR = ingest;
      try {
        const vo = await new OperatorRecordingProvider().synthesize({
          scriptText: LINES.join(" "),
          voiceProfileId: "narration.wav",
          segments: LINES,
        });
        expect(vo.cueTiming).toBe("TRANSCRIPT_ALIGNED");
        expect(vo.isSynthetic).toBe(false);
        expect(vo.isFixture).toBe(false);
        expect(vo.cues!.map((c) => c.text)).toEqual(LINES);
        for (const [i, c] of vo.cues!.entries()) {
          expect(Math.abs(c.startSec - truth[i]!)).toBeLessThanOrEqual(0.35);
        }
        // Spreading by text length would have missed line 2 by more than a second.
        const total = LINES.reduce((a, s) => a + s.length, 0);
        const naive2 = (LINES[0]!.length / total) * vo.durationSec;
        expect(Math.abs(naive2 - truth[1]!)).toBeGreaterThan(1);
        const recorded = path.join(dir, "recorded.wav");
        await writeFile(recorded, vo.audioBytes);
        const qa = await narrationQa({
          wavPath: recorded,
          lines: LINES,
          cues: vo.cues!,
          cueTiming: vo.cueTiming!,
        });
        expect(qa.checks.filter((x) => x.status === "FAIL")).toEqual([]);
      } finally {
        if (saved === undefined) delete process.env.CAPTURE_INGEST_DIR;
        else process.env.CAPTURE_INGEST_DIR = saved;
      }
    },
    120_000,
  );
});

describe("rendered masters", () => {
  const render = async (
    format: "16:9" | "9:16",
    voice: string,
    opts: { cards?: typeof CARDS; cues?: Cue[] } = {},
  ) => {
    const line = opts.cues ?? cues;
    const dur = Math.round(((await probeDurationSec(voice)) + 1) * 100) / 100;
    const display = chunkCues(line, format);
    const r = await new LocalFfmpegCompositorProvider().render({
      sourceVideoReference: "cards",
      voiceoverAssetPath: "",
      attributionText: "Test",
      voiceoverPath: voice,
      clip: { startSec: 0, durationSec: dur },
      cues: display,
      format,
      fixtureLabel:
        "INTERNAL DRAFT - ILLUSTRATIVE GRAPHICS - SYNTHETIC VOICE - NOT GAMEPLAY - NOT FOR PUBLICATION",
      cards: {
        cards: opts.cards ?? CARDS,
        startsSec: (opts.cards ?? CARDS).map((_, i) => line[i]!.startSec),
      },
    });
    const master = path.join(
      dir,
      `m-${format.replace(":", "x")}-${Math.random().toString(36).slice(2, 7)}.mp4`,
    );
    await writeFile(master, r.videoBytes);
    return { master, dur: r.durationSec, display, r };
  };
  const qaFor = (m: Awaited<ReturnType<typeof render>>, format: "16:9" | "9:16", cards = CARDS) =>
    renderQa({
      masterPath: m.master,
      format,
      durationSec: m.dur,
      lineCues: cues,
      displayCues: m.display,
      lines: LINES,
      hasSourceAudio: false,
      cards: {
        format,
        cards,
        startsSec: cards.map((_, i) => cues[i]!.startSec),
        durationSec: m.dur,
      },
    });

  it("normalizes a quiet and a hot narration to the same loudness, within one LU of target", async () => {
    const quiet = path.join(dir, "quiet.wav");
    const hot = path.join(dir, "hot.wav");
    await ffmpeg(["-i", wav, "-af", "volume=-22dB", quiet]);
    await ffmpeg(["-i", wav, "-af", "volume=6dB,alimiter=limit=0.95", hot]);
    const before = [await measureLoudness(quiet), await measureLoudness(hot)];
    expect(Math.abs(before[0]!.integratedLufs - before[1]!.integratedLufs)).toBeGreaterThan(15);
    for (const voice of [quiet, hot]) {
      const m = await render("16:9", voice);
      const l = await measureLoudness(m.master);
      expect(Math.abs(l.integratedLufs - LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(1);
      expect(l.truePeakDb).toBeLessThanOrEqual(-1);
      expect(loudnessProblems(l)).toEqual([]);
      expect(m.r.loudnorm).toMatchObject({
        input_i: expect.any(String),
        target_offset: expect.any(String),
      });
    }
    expect(loudnessProblems({ integratedLufs: -23, rangeLu: 3, truePeakDb: -0.2 })).toHaveLength(2);
  }, 180_000);

  it("passes full QA in both native layouts and produces a contact sheet", async () => {
    for (const format of ["16:9", "9:16"] as const) {
      const m = await render(format, wav);
      const qa = await qaFor(m, format);
      expect(qa.report.checks.filter((c) => c.status === "FAIL")).toEqual([]);
      expect(qa.report.verified).toBe(HAS_MODEL);
      expect(qa.report.checks.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          "Loudness",
          "Narration under every line",
          "Speech matches script",
          "Captions follow the transcript",
          "No black picture",
          "Every card is on screen",
          "Captions fit the safe area",
          "Captions are burned in",
        ]),
      );
      expect(qa.contactSheet.subarray(0, 2).toString("hex")).toBe("ffd8"); // a real JPEG
      expect(qa.report.humanValidation.join(" ")).toMatch(/Listen to the narration/);
    }
  }, 240_000);

  it("refuses a master with a missing card, and one whose captions were not burned in", async () => {
    // Rendered with two cards, but the plan (and the script) has three.
    const m = await render("16:9", wav, {
      cards: [...CARDS.slice(0, 2), { label: "", value: " ", note: "" }],
    });
    const missing = await qaFor(m, "16:9");
    expect(check(missing.report, "Every card is on screen").status).toBe("FAIL");
    expect(check(missing.report, "Every card is on screen").detail).toMatch(
      /card 3 shows no text at/,
    );
    expect(missing.report.passed).toBe(false);

    // Same picture with the caption track left out.
    const bare = await new LocalFfmpegCompositorProvider().render({
      sourceVideoReference: "cards",
      voiceoverAssetPath: "",
      attributionText: "Test",
      voiceoverPath: wav,
      clip: { startSec: 0, durationSec: m.dur },
      cues: [],
      format: "16:9",
      cards: { cards: CARDS, startsSec: cues.map((c) => c.startSec) },
    });
    const barePath = path.join(dir, "bare.mp4");
    await writeFile(barePath, bare.videoBytes);
    const noCaps = await qaFor({ ...m, master: barePath }, "16:9");
    expect(check(noCaps.report, "Captions are burned in").status).toBe("FAIL");
    expect(check(noCaps.report, "Captions are burned in").detail).toMatch(
      /caption 1 is not visible/,
    );
  }, 240_000);

  it("refuses a master whose narration does not match the script", async () => {
    const m = await render("16:9", wav);
    const qa = await renderQa({
      masterPath: m.master,
      format: "16:9",
      durationSec: m.dur,
      lineCues: cues,
      displayCues: m.display,
      lines: [LINES[0]!, "An entirely different second sentence was scripted here.", LINES[2]!],
      hasSourceAudio: false,
    });
    expect(check(qa.report, "Speech matches script").status).toBe(
      HAS_MODEL ? "FAIL" : "NOT_VERIFIED",
    );
  }, 120_000);

  it("fills the frame with a vertical source instead of raising it (9:16 layout fix)", async () => {
    const tall = path.join(dir, "tall.mp4");
    const wide = path.join(dir, "wide.mp4");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=white:size=1080x1920:rate=30:duration=4",
      "-pix_fmt",
      "yuv420p",
      tall,
    ]);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=white:size=1280x720:rate=30:duration=4",
      "-pix_fmt",
      "yuv420p",
      wide,
    ]);
    const strip = { x: 340, y: 1860, w: 400, h: 40 };
    const out: number[] = [];
    for (const src of [tall, wide]) {
      const r = await new LocalFfmpegCompositorProvider().render({
        sourceVideoReference: "x",
        voiceoverAssetPath: "",
        attributionText: "",
        sourceVideoPath: src,
        sourceHasAudio: false,
        voiceoverPath: wav,
        clip: { startSec: 0, durationSec: 3 },
        cues: [],
        format: "9:16",
      });
      const p = path.join(dir, `layout-${out.length}.mp4`);
      await writeFile(p, r.videoBytes);
      out.push((await bandStats(p, 1, strip)).yavg);
      expect(existsSync(p)).toBe(true);
    }
    // Vertical footage reaches the bottom edge at full brightness; landscape
    // footage leaves the darkened fill there.
    expect(out[0]!).toBeGreaterThan(225);
    expect(out[1]!).toBeLessThan(out[0]! - 15);
  }, 120_000);
});
