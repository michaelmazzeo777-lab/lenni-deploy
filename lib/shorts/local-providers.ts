import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, meanVolumeDb, probeDurationSec, probeVideo, run } from "@/lib/media/ffmpeg";
import { AUDIO_EXT, resolveIngestFile } from "@/lib/media/ingest";
import {
  LOUDNESS_TARGET_LUFS,
  LOUDNORM_MEASURE,
  TRUE_PEAK_MAX_DB,
  TRUE_PEAK_TARGET_DB,
  detectSilences,
  loudnormApply,
  measureLoudness,
  parseLoudnormJson,
} from "@/lib/media/audio-qa";
import { compareScript, cuesFromComparison } from "@/lib/media/align";
import { transcribe } from "@/lib/media/transcribe";
import { CAPTION_STYLE } from "@/lib/media/captions";
import { buildCardsGraph } from "@/lib/media/cards";
import type {
  CaptionCue,
  RenderFormat,
  RenderResult,
  ShortsScriptProvider,
  ShortsScriptResult,
  TTSProvider,
  TTSResult,
  VideoCompositorProvider,
} from "@/lib/shorts/types";

// Local, $0, no-network providers that produce REAL media on this machine:
//   local-operator      script written by the operator (no AI)
//   local-say-fixture   macOS system voice - FIXTURE narration, never publishable
//   operator-recording  a real narration file dropped in the ingest folder
//   local-ffmpeg        real H.264/AAC MP4 with burned captions

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "shorts-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SILENCE_DB = -50;
const GAP_SEC = 0.25;

export class LocalOperatorScriptProvider implements ShortsScriptProvider {
  readonly name = "local-operator";

  async analyzeAndDraft(input: {
    videoReference: string;
    durationCeilingSec: number;
    operatorScript?: { hookText: string; lines: string[] };
    highlights?: ShortsScriptResult["detectedHighlights"];
  }): Promise<ShortsScriptResult> {
    const s = input.operatorScript;
    if (!s || !s.hookText.trim() || s.lines.length === 0) {
      throw new Error("A hook and at least one script line are required");
    }
    // Deterministic text screen only; the human render review is the real gate.
    const text = [s.hookText, ...s.lines].join(" ");
    const flagged = /\bleak(s|ed|ing)?\b/i.test(text);
    return {
      detectedHighlights: input.highlights ?? [],
      safetyFlags: flagged
        ? [{ timestampSec: 0, category: "leak-reference-review", confidence: 1 }]
        : [],
      script: {
        hookText: s.hookText.trim(),
        sections: s.lines.map((line) => ({ text: line.trim(), timestampSec: 0 })),
      },
      model: "operator-authored",
    };
  }
}

async function assertAudible(wavPath: string): Promise<void> {
  if ((await meanVolumeDb(wavPath)) < SILENCE_DB) {
    throw new Error("Narration audio is silent - a silent track is not a narration");
  }
}

export class LocalSayFixtureTTSProvider implements TTSProvider {
  readonly name = "local-say-fixture";

  async synthesize(input: {
    scriptText: string;
    voiceProfileId: string;
    segments?: string[];
  }): Promise<TTSResult> {
    const segments = (input.segments ?? [input.scriptText]).map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) throw new Error("Narration script is empty");
    const voice = /^[A-Za-z][A-Za-z ()-]{0,40}$/.test(input.voiceProfileId)
      ? input.voiceProfileId
      : null;
    return withTmp(async (dir) => {
      const cues: CaptionCue[] = [];
      const inputs: string[] = [];
      let t = 0;
      for (const [i, text] of segments.entries()) {
        const raw = path.join(dir, `s${i}.aiff`);
        await run("say", [
          ...(voice && voice !== "default" ? ["-v", voice] : []),
          "-o",
          raw,
          "--",
          text,
        ]);
        // The system voice leaves up to ~0.4s of silence before the first
        // word. Trim it so each caption starts with its speech.
        const seg = path.join(dir, `s${i}.wav`);
        await ffmpeg([
          "-i",
          raw,
          "-af",
          "silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB",
          seg,
        ]);
        const d = await probeDurationSec(seg);
        cues.push({ startSec: t, endSec: t + d, text });
        t += d + GAP_SEC;
        inputs.push("-i", seg);
      }
      const graph =
        segments.map((_, i) => `[${i}:a]apad=pad_dur=${GAP_SEC}[a${i}];`).join("") +
        segments.map((_, i) => `[a${i}]`).join("") +
        `concat=n=${segments.length}:v=0:a=1[a]`;
      const out = path.join(dir, "vo.wav");
      await ffmpeg([
        ...inputs,
        "-filter_complex",
        graph,
        "-map",
        "[a]",
        "-ar",
        "48000",
        "-ac",
        "1",
        out,
      ]);
      await assertAudible(out);
      return {
        audioBytes: await readFile(out),
        durationSec: Math.round(t * 100) / 100,
        duckingCurve: [{ timestampSec: 0, gainDb: -12 }],
        cues,
        isFixture: true,
        isSynthetic: true,
        voiceName: voice && voice !== "default" ? `macOS "${voice}"` : "macOS system default voice",
        voiceLicenseNote:
          "Apple system voice (synthetic). Licence for publication has not been reviewed.",
        cueTiming: "EXACT",
      };
    });
  }
}

export class OperatorRecordingProvider implements TTSProvider {
  readonly name = "operator-recording";

  // voiceProfileId = file name of the narration recording in the ingest folder.
  async synthesize(input: {
    scriptText: string;
    voiceProfileId: string;
    segments?: string[];
  }): Promise<TTSResult> {
    const src = await resolveIngestFile(input.voiceProfileId, AUDIO_EXT);
    const segments = (input.segments ?? [input.scriptText]).map((s) => s.trim()).filter(Boolean);
    return withTmp(async (dir) => {
      const out = path.join(dir, "vo.wav");
      await ffmpeg(["-i", src, "-vn", "-ar", "48000", "-ac", "1", out]);
      await assertAudible(out);
      const durationSec = await probeDurationSec(out);
      // Caption times come from where each line's words are actually heard
      // (local transcription), snapped to the nearest speech onset.
      let cues: CaptionCue[] | null = null;
      const heard = await transcribe(out);
      if (heard.status === "OK") {
        cues = cuesFromComparison(
          segments,
          compareScript(segments, heard.words),
          durationSec,
          await detectSilences(out, durationSec, { minSec: 0.15 }),
        );
      }
      const cueTiming = cues ? "TRANSCRIPT_ALIGNED" : "APPROXIMATE";
      if (!cues) {
        // No transcript: spread cues by text length. APPROXIMATE - flagged for
        // a human sync check in QA.
        const total = segments.reduce((a, s) => a + s.length, 0) || 1;
        let t = 0;
        cues = segments.map((text) => {
          const d = (text.length / total) * durationSec;
          const cue = { startSec: t, endSec: t + d, text };
          t += d;
          return cue;
        });
      }
      return {
        audioBytes: await readFile(out),
        durationSec,
        duckingCurve: [{ timestampSec: 0, gainDb: -12 }],
        cues,
        isFixture: false,
        isSynthetic: false,
        voiceName: `Recording "${input.voiceProfileId}"`,
        voiceLicenseNote: "Operator-supplied recording; rights attested by the operator.",
        cueTiming,
      };
    });
  }
}

const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
const assText = (s: string) => s.replace(/[{}\\]/g, "").replace(/\s*\n\s*/g, " ");

function buildAss(opts: {
  width: number;
  height: number;
  durationSec: number;
  cues: CaptionCue[];
  attributionText: string;
  fixtureLabel?: string;
}): string {
  const cap = CAPTION_STYLE[opts.height > opts.width ? "9:16" : "16:9"];
  const end = assTime(opts.durationSec);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Caption,Helvetica Neue,${cap.size},&H00FFFFFF,&H00000000,&H80000000,1,1,5,1,2,${cap.marginH},${cap.marginH},${cap.marginV}`,
    "Style: Attribution,Helvetica Neue,30,&H00FFFFFF,&H00000000,&H80000000,0,1,2,0,1,40,40,40",
    "Style: Fixture,Helvetica Neue,34,&H00FFFFFF,&H000000FF,&H000000C0,1,3,6,0,8,40,40,60",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    `Dialogue: 0,0:00:00.00,${end},Attribution,${assText(opts.attributionText)}`,
  ];
  if (opts.fixtureLabel) {
    lines.push(`Dialogue: 1,0:00:00.00,${end},Fixture,${assText(opts.fixtureLabel)}`);
  }
  for (const c of opts.cues) {
    if (c.startSec >= opts.durationSec) continue;
    lines.push(
      `Dialogue: 2,${assTime(c.startSec)},${assTime(Math.min(c.endSec, opts.durationSec))},Caption,${assText(c.text)}`,
    );
  }
  return lines.join("\n") + "\n";
}

const SIZE: Record<RenderFormat, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
};

export class LocalFfmpegCompositorProvider implements VideoCompositorProvider {
  readonly name = "local-ffmpeg";

  async render(input: Parameters<VideoCompositorProvider["render"]>[0]): Promise<RenderResult> {
    const { sourceVideoPath, voiceoverPath, clip } = input;
    if ((!sourceVideoPath && !input.cards) || !voiceoverPath || !clip) {
      throw new Error("Local render needs a picture source, a narration track and a clip range");
    }
    const format = input.format ?? "9:16";
    const { w, h } = SIZE[format];
    const dur = clip.durationSec;

    return withTmp(async (dir) => {
      await writeFile(
        path.join(dir, "c.ass"),
        buildAss({
          width: w,
          height: h,
          durationSec: dur,
          cues: input.cues ?? [],
          attributionText: input.attributionText,
          fixtureLabel: input.fixtureLabel,
        }),
      );
      // Inputs: explainers have no footage (the picture is generated in the
      // graph), so the narration is input 0; otherwise footage 0, narration 1.
      const footage = sourceVideoPath
        ? ["-ss", String(clip.startSec), "-t", String(dur), "-i", sourceVideoPath]
        : [];
      const inputs = [...footage, "-i", voiceoverPath];
      const vo = sourceVideoPath ? 1 : 0;

      let video: string;
      if (input.cards) {
        // Native layout for each frame shape; see lib/media/cards.ts.
        video =
          (await buildCardsGraph(dir, {
            format,
            cards: input.cards.cards,
            startsSec: input.cards.startsSec,
            durationSec: dur,
          })) + `;[cards]ass=c.ass[v]`;
      } else if (format === "9:16") {
        // Landscape footage: full width over a blurred fill, raised 140px so
        // captions clear it (no HUD is cropped away). Footage that already
        // fills the frame (native vertical) is centred, not raised.
        video =
          `[0:v]fps=30,split[a][b];` +
          `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:2,eq=brightness=-0.12[bg];` +
          `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
          `[bg][fg]overlay=(W-w)/2:'(H-h)/2-140*lt(h\\,H-280)',ass=c.ass[v]`;
      } else {
        video =
          `[0:v]fps=30,scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
          `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,ass=c.ass[v]`;
      }
      // Game audio ducked 12 dB under the narration. Loudness is normalized in
      // two passes: measure the mix, then apply a linear gain to the target.
      const mix =
        input.sourceHasAudio && sourceVideoPath
          ? `[0:a]volume=-12dB[g];[${vo}:a]apad[n];[g][n]amix=inputs=2:duration=first:normalize=0`
          : `[${vo}:a]apad`;
      const pass1 = await ffmpeg(
        [
          ...inputs,
          "-filter_complex",
          `${mix},${LOUDNORM_MEASURE}[au]`,
          "-map",
          "[au]",
          "-t",
          String(dur),
          "-f",
          "null",
          "-",
        ],
        { cwd: dir },
      );
      const measured = parseLoudnormJson(pass1.stderr);
      const chain = `${mix},${loudnormApply(measured)}`;
      const audio = `${chain}[au]`;
      let out = path.join(dir, "out.mp4");
      await ffmpeg(
        [
          ...inputs,
          "-filter_complex",
          `${video};${audio}`,
          "-map",
          "[v]",
          "-map",
          "[au]",
          "-t",
          String(dur),
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          out,
        ],
        { cwd: dir },
      );
      // Two things move the encoded audio off its targets: loudnorm lands low
      // on short clips, and the AAC encoder can lift true peaks about 2 dB
      // above what loudnorm set. So measure the encoded master and, while it
      // misses the loudness target or the peak ceiling, encode the audio again
      // with the missing gain behind a peak limiter (three tries at most). The
      // picture is copied untouched. QA still makes the final judgement.
      const first = out;
      let gainDb = 0;
      let limitDb = TRUE_PEAK_TARGET_DB;
      for (let pass = 1; pass <= 3; pass++) {
        const got = await measureLoudness(out);
        const miss = LOUDNESS_TARGET_LUFS - got.integratedLufs;
        const over = Math.max(0, got.truePeakDb - (TRUE_PEAK_MAX_DB - 0.3));
        if (Math.abs(miss) <= 0.5 && over === 0) break;
        if (Math.abs(miss) > 0.5) gainDb += miss;
        limitDb -= over + 0.2;
        const limit = Math.pow(10, limitDb / 20).toFixed(3);
        out = path.join(dir, `out${pass}.mp4`);
        await ffmpeg(
          [
            ...inputs,
            "-i",
            first,
            "-filter_complex",
            `${chain},volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:level=false[au]`,
            "-map",
            `${vo + 1}:v`,
            "-map",
            "[au]",
            "-t",
            String(dur),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            out,
          ],
          { cwd: dir },
        );
      }
      const probe = await probeVideo(out);
      if (probe.width !== w || probe.height !== h || !probe.audioCodec) {
        throw new Error(`Render validation failed: got ${probe.width}x${probe.height}`);
      }
      const cover = path.join(dir, "cover.jpg");
      await ffmpeg([
        "-ss",
        String(Math.min(1, dur / 2)),
        "-i",
        out,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        cover,
      ]);
      return {
        videoBytes: await readFile(out),
        durationSec: Math.round(probe.durationSec * 100) / 100,
        resolution: `${w}x${h}`,
        frameRate: 30,
        renderCostUsd: 0,
        coverJpg: await readFile(cover),
        loudnorm: measured as unknown as Record<string, string>,
      };
    });
  }
}
