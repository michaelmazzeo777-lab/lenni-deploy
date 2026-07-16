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

export interface ShortsScriptProvider {
  readonly name: string;
  analyzeAndDraft(input: {
    videoReference: string;
    durationCeilingSec: number;
  }): Promise<ShortsScriptResult>;
}

export interface TTSResult {
  audioBytes: Buffer; // caller persists via AssetStorage (quarantine-first)
  durationSec: number;
  duckingCurve: { timestampSec: number; gainDb: number }[];
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: { scriptText: string; voiceProfileId: string }): Promise<TTSResult>;
}

export interface RenderResult {
  videoBytes: Buffer; // caller persists via AssetStorage
  durationSec: number;
  resolution: string;
  frameRate: number;
  renderCostUsd: number;
}

export interface VideoCompositorProvider {
  readonly name: string;
  render(input: {
    sourceVideoReference: string;
    voiceoverAssetPath: string;
    attributionText: string;
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
