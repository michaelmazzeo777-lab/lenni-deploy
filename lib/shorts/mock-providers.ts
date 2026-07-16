import { createHash } from "node:crypto";
import type {
  ShortsScriptProvider,
  ShortsScriptResult,
  TTSProvider,
  TTSResult,
  VideoCompositorProvider,
  RenderResult,
  YouTubePublisher,
} from "@/lib/shorts/types";

// Deterministic mocks: identical input -> identical output. No network, no
// key, no cost. The mock "media" bytes are tiny valid-signature placeholders,
// never real footage.

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// A safety flag is emitted only when the video reference contains this marker,
// so tests can exercise the human-review routing deterministically.
export const MOCK_SAFETY_TRIGGER = "MOCK-SAFETY-TRIGGER";

export class MockShortsScriptProvider implements ShortsScriptProvider {
  readonly name = "mock";

  async analyzeAndDraft(input: {
    videoReference: string;
    durationCeilingSec: number;
  }): Promise<ShortsScriptResult> {
    const h = stableHash(input.videoReference);
    const flagged = input.videoReference.includes(MOCK_SAFETY_TRIGGER);
    return {
      detectedHighlights: [
        { timestampSec: 2, label: `highlight-${h.slice(0, 6)}`, confidence: 0.92 },
        {
          timestampSec: Math.min(15, input.durationCeilingSec - 5),
          label: "action",
          confidence: 0.81,
        },
      ],
      safetyFlags: flagged
        ? [{ timestampSec: 4, category: "graphic-violence-review", confidence: 0.77 }]
        : [],
      script: {
        hookText: "Here's the one detail everyone missed in this clip.",
        sections: [
          { text: "Watch the top-left of the frame as the sequence starts.", timestampSec: 3 },
          {
            text: "That environmental detail is confirmed in official material.",
            timestampSec: 12,
          },
          { text: "Follow for the next verified breakdown.", timestampSec: 25 },
        ],
      },
      model: "mock-shorts-script-1",
    };
  }
}

// Minimal valid WAV: 44-byte RIFF header + a short run of silence. Real bytes,
// playable, zero cost.
function silentWav(durationSec: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

export class MockTTSProvider implements TTSProvider {
  readonly name = "mock";

  async synthesize(input: { scriptText: string; voiceProfileId: string }): Promise<TTSResult> {
    // ~150 words/minute speaking pace approximated from character count.
    const durationSec = Math.max(1, Math.round(input.scriptText.length / 14));
    return {
      audioBytes: silentWav(Math.min(durationSec, 5)), // cap mock size
      durationSec,
      duckingCurve: [
        { timestampSec: 0, gainDb: -12 },
        { timestampSec: durationSec, gainDb: 0 },
      ],
    };
  }
}

// Minimal MP4 signature (ftyp box) placeholder. Not a playable movie — the
// mock exists to exercise storage/gating, and says so in its name.
function placeholderMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from("isomiso2mp41", "ascii"),
  ]);
}

export class MockVideoCompositorProvider implements VideoCompositorProvider {
  readonly name = "mock";

  async render(input: {
    sourceVideoReference: string;
    voiceoverAssetPath: string;
    attributionText: string;
  }): Promise<RenderResult> {
    void input;
    return {
      videoBytes: placeholderMp4(),
      durationSec: 45,
      resolution: "1080x1920",
      frameRate: 30, // cost decision: 30fps default (see blueprint)
      renderCostUsd: 0,
    };
  }
}

export class MockYouTubePublisher implements YouTubePublisher {
  readonly name = "mock";

  async publish(input: {
    videoAssetPath: string;
    title: string;
    description: string;
    tags: string[];
    disclosureFlags: Record<string, boolean>;
  }): Promise<{ youtubeVideoId: string }> {
    // Deterministic fake ID; clearly marked as mock so it can never be
    // mistaken for a real YouTube video id.
    return { youtubeVideoId: `mock-${stableHash(input.videoAssetPath).slice(0, 11)}` };
  }
}
