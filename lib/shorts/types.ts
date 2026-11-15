// YouTube Shorts pipeline provider seams (docs/YOUTUBE_SHORTS_PIPELINE_BLUEPRINT.md).
// Mock-first, exactly like AIProvider/VisualProvider: deterministic mocks are
// the default; real providers stay disabled stubs until their credentials are
// configured. No provider is ever invoked with real credentials from tests.

export interface DetectedHighlight {
  timestampSec: number;
  label: string;
  confidence: number;
}

export interface SafetyFlag {
  timestampSec: number;
  category: string;
  confidence: number;
}

export interface ShortsScriptResult {
  detectedHighlights: DetectedHighlight[];
  safetyFlags: SafetyFlag[];
  script: { hookText: string; sections: { text: string; timestampSec: number }[] };
  model: string; // ACTUAL configured identifier, never assumed
}

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface ShortsScriptProvider {
  readonly name: string;
  analyzeAndDraft(input: {
    videoReference: string;
    durationCeilingSec: number;
    // Local pipeline: the operator writes the script; the approved highlight
    // cut is passed through for reference. Ignored by the mock.
    operatorScript?: { hookText: string; lines: string[] };
    highlights?: DetectedHighlight[];
  }): Promise<ShortsScriptResult>;
}

export interface TTSResult {
  audioBytes: Buffer; // caller persists via AssetStorage (quarantine-first)
  durationSec: number;
  duckingCurve: { timestampSec: number; gainDb: number }[];
  cues?: CaptionCue[]; // caption timing, when the provider can supply it
  isFixture?: boolean; // true = not a publishable narration (e.g. system voice)
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: {
    scriptText: string;
    voiceProfileId: string;
    segments?: string[]; // script lines in order (hook first)
  }): Promise<TTSResult>;
}

export interface RenderResult {
  videoBytes: Buffer; // caller persists via AssetStorage
  durationSec: number;
  resolution: string;
  frameRate: number;
  renderCostUsd: number;
  coverJpg?: Buffer;
}

export type RenderFormat = "9:16" | "16:9";

export interface VideoCompositorProvider {
  readonly name: string;
  render(input: {
    sourceVideoReference: string;
    voiceoverAssetPath: string;
    attributionText: string;
    // Local pipeline only (absolute paths resolved by the domain layer).
    sourceVideoPath?: string;
    sourceHasAudio?: boolean;
    voiceoverPath?: string;
    clip?: { startSec: number; durationSec: number };
    cues?: CaptionCue[];
    format?: RenderFormat;
    fixtureLabel?: string; // burned in when any input is a fixture
  }): Promise<RenderResult>;
}

export interface YouTubePublisher {
  readonly name: string;
  publish(input: {
    videoAssetPath: string;
    title: string;
    description: string;
    tags: string[];
    disclosureFlags: Record<string, boolean>;
  }): Promise<{ youtubeVideoId: string }>;
}
