// Hand-written signal bins from the Gemini v3.1 candidate's ranker comparison
// (copied unchanged from its compareAgainstClaudeBaselineRanker()). These are
// arrays of numbers, not video: nothing here was measured from footage, and the
// "traps" are defined by the very field (lumaVariance) the experimental filter
// keys on. Kept as a regression fixture, not as accuracy evidence.
import type { SignalBin } from "@/lib/media/highlights";

export interface HeldOutComparisonClip {
  clipId: string;
  description: string;
  heldOutFromTuning: true;
  bins: SignalBin[];
  groundTruthWindows: { startSec: number; endSec: number; kind: string }[];
  trapWindows: { startSec: number; endSec: number; kind: string }[];
}

export const makeBins = (
  durationSec: number,
  overrides: (t: number) => Partial<SignalBin>,
): SignalBin[] =>
  Array.from({ length: durationSec }, (_, t) => ({
    t,
    motion: 0.35,
    luma: 65,
    cuts: 0,
    rmsDb: -42,
    lumaVariance: 24,
    voiceCallout: false,
    ...overrides(t),
  }));

export const HELD_OUT_CLIPS: HeldOutComparisonClip[] = [
  {
    clipId: "heldout_01_pulsing_lobby_spinner_and_stealth",
    description:
      "Withheld clip 1: Animated loading spinner + loud lobby music (4s-12s), quiet tactical stealth infiltration (22s-30s), high-action escape (42s-50s)",
    heldOutFromTuning: true,
    bins: makeBins(60, (t) => {
      if (t >= 4 && t <= 11) {
        return { motion: 1.15, luma: 40, cuts: 0, rmsDb: -6, lumaVariance: 3.2 };
      }
      if (t >= 22 && t <= 29) {
        return {
          motion: 3.8,
          luma: 82,
          cuts: t === 24 ? 1 : 0,
          rmsDb: -36,
          lumaVariance: 48,
          voiceCallout: t === 25,
        };
      }
      if (t >= 42 && t <= 49) {
        return { motion: 9.5, luma: 110, cuts: t % 3 === 0 ? 1 : 0, rmsDb: -8, lumaVariance: 64 };
      }
      return {};
    }),
    groundTruthWindows: [
      { startSec: 22, endSec: 30, kind: "quiet_tactical_stealth" },
      { startSec: 42, endSec: 50, kind: "high_action_escape" },
    ],
    trapWindows: [{ startSec: 4, endSec: 12, kind: "animated_loading_spinner_loud_music" }],
  },
  {
    clipId: "heldout_02_dual_rapid_peaks_with_pause_bait",
    description:
      "Withheld clip 2: Dual rapid action peaks (10s-16s and 24s-31s) followed by pulsing map-screen pause bait (38s-46s)",
    heldOutFromTuning: true,
    bins: makeBins(55, (t) => {
      if (t >= 10 && t <= 15) {
        return { motion: 8.2, luma: 95, cuts: 1, rmsDb: -11, lumaVariance: 55 };
      }
      if (t >= 24 && t <= 30) {
        return {
          motion: 6.4,
          luma: 88,
          cuts: 1,
          rmsDb: -14,
          lumaVariance: 52,
          voiceCallout: t === 26,
        };
      }
      if (t >= 38 && t <= 45) {
        return { motion: 1.05, luma: 48, cuts: 0, rmsDb: -5, lumaVariance: 4.0 };
      }
      return {};
    }),
    groundTruthWindows: [
      { startSec: 10, endSec: 16, kind: "rapid_peak_1" },
      { startSec: 24, endSec: 31, kind: "rapid_peak_2" },
    ],
    trapWindows: [{ startSec: 38, endSec: 46, kind: "pulsing_map_pause_radio_bait" }],
  },
  {
    clipId: "heldout_03_low_audio_vehicle_maneuver",
    description:
      "Withheld clip 3: Black loading screen with audio pop (2s-7s), low-audio precision vehicle maneuver (18s-26s), late ambush peak (36s-44s)",
    heldOutFromTuning: true,
    bins: makeBins(52, (t) => {
      if (t >= 2 && t <= 6) {
        return { motion: 0.02, luma: 8, cuts: 0, rmsDb: -7, lumaVariance: 1.0 };
      }
      if (t >= 18 && t <= 25) {
        return {
          motion: 4.6,
          luma: 92,
          cuts: t === 20 ? 1 : 0,
          rmsDb: -38,
          lumaVariance: 58,
          voiceCallout: t === 21,
        };
      }
      if (t >= 36 && t <= 43) {
        return { motion: 10.2, luma: 105, cuts: 1, rmsDb: -9, lumaVariance: 62 };
      }
      return {};
    }),
    groundTruthWindows: [
      { startSec: 18, endSec: 26, kind: "low_audio_precision_maneuver" },
      { startSec: 36, endSec: 44, kind: "late_ambush_peak" },
    ],
    trapWindows: [{ startSec: 2, endSec: 7, kind: "black_loading_audio_pop" }],
  },
];
