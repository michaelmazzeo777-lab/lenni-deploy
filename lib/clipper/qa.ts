// QA for one rendered session clip. A raw session has no reference script,
// so this does not reuse lib/media/qa.ts's narrationQa/renderQa (built around
// comparing speech to a known script); it composes the same measurement
// building blocks (loudness, caption safe-area, caption burn-in visibility,
// full decode) into a report with the same shape so the Studio's existing
// QA display works unchanged.
import { probeVideo } from "@/lib/media/ffmpeg";
import { loudnessProblems, type Loudness } from "@/lib/media/audio-qa";
import { bandStats, captionFitProblems, type QaCheck, type QaReport } from "@/lib/media/qa";
import { captionBand, CAPTION_STYLE, type Cue, type RenderFormat } from "@/lib/media/captions";
import { CLIP_MAX_SEC, CLIP_MIN_SEC } from "@/lib/clipper/moments";

function finish(checks: QaCheck[], measurements: Record<string, unknown>): QaReport {
  return {
    passed: !checks.some((c) => c.status === "FAIL"),
    verified: !checks.some((c) => c.status === "NOT_VERIFIED"),
    checks,
    measurements,
    humanValidation: [
      "Watch the whole clip in this format",
      "Confirm the clip is a fair, in-context excerpt of the session",
    ],
  };
}

export interface ClipQaInput {
  masterPath: string;
  format: RenderFormat;
  /** Burned-in display cues, clip-relative (after chunkCues). */
  displayCues: Cue[];
  loudness: Loudness;
}

export async function clipQa(input: ClipQaInput): Promise<QaReport> {
  const checks: QaCheck[] = [];
  const probe = await probeVideo(input.masterPath);
  const want = input.format === "16:9" ? [1920, 1080] : [1080, 1920];
  const lengthOk =
    probe.durationSec >= CLIP_MIN_SEC - 0.5 && probe.durationSec <= CLIP_MAX_SEC + 0.5;
  checks.push({
    name: "Full decode",
    status:
      probe.width === want[0] && probe.height === want[1] && probe.audioCodec && lengthOk
        ? "PASS"
        : "FAIL",
    detail: `${probe.width}x${probe.height}, ${probe.durationSec.toFixed(1)}s, audio ${probe.audioCodec ?? "missing"}`,
  });

  const loud = loudnessProblems(input.loudness);
  checks.push({
    name: "Loudness",
    status: loud.length ? "FAIL" : "PASS",
    detail: loud.length
      ? loud.join("; ")
      : `${input.loudness.integratedLufs.toFixed(1)} LUFS integrated, true peak ${input.loudness.truePeakDb.toFixed(1)} dBFS`,
  });

  const fit = captionFitProblems(input.displayCues, input.format);
  checks.push({
    name: "Captions fit the safe area",
    status: fit.length ? "FAIL" : "PASS",
    detail: fit.length
      ? fit.join("; ")
      : `${input.displayCues.length} captions, each within ${CAPTION_STYLE[input.format].maxLines} lines`,
  });

  const cband = captionBand(input.format);
  const hidden: string[] = [];
  for (const [i, c] of input.displayCues.entries()) {
    if (c.endSec - c.startSec < 0.3) continue;
    const s = await bandStats(input.masterPath, (c.startSec + c.endSec) / 2, cband);
    if (s.ymax < 220) hidden.push(`caption ${i + 1} is not visible at ${c.startSec.toFixed(1)}s`);
  }
  checks.push({
    name: "Captions are burned in",
    status: input.displayCues.length === 0 ? "WARN" : hidden.length ? "FAIL" : "PASS",
    detail:
      input.displayCues.length === 0
        ? "no speech was transcribed in this window; no captions to check"
        : hidden.length
          ? hidden.join("; ")
          : "caption text is present in the picture during every caption",
  });

  return finish(checks, { loudness: input.loudness, durationSec: probe.durationSec });
}
