import type {
  ShortsScriptProvider,
  TTSProvider,
  VideoCompositorProvider,
  YouTubePublisher,
} from "@/lib/shorts/types";
import {
  MockShortsScriptProvider,
  MockTTSProvider,
  MockVideoCompositorProvider,
  MockYouTubePublisher,
} from "@/lib/shorts/mock-providers";

export * from "@/lib/shorts/types";
export { MOCK_SAFETY_TRIGGER } from "@/lib/shorts/mock-providers";

// Provider selection, server-side env only. Deny-by-default: every provider
// is the deterministic mock unless explicitly configured AND credentialed.
// Real implementations are added only when Mike supplies credentials
// (docs/YOUTUBE_SHORTS_PIPELINE_BLUEPRINT.md §6); until then a non-mock
// selection fails loudly rather than silently falling back.

function requireConfigured(kind: string, provider: string, keyVar: string): never {
  throw new Error(
    `${kind} provider "${provider}" is selected but not available: ` +
      `no implementation is wired yet and/or ${keyVar} is not set. ` +
      `Set the provider env var to "mock" (default) or supply real credentials.`,
  );
}

export function getShortsScriptProvider(): ShortsScriptProvider {
  const p = process.env.SHORTS_SCRIPT_PROVIDER ?? "mock";
  if (p === "mock") return new MockShortsScriptProvider();
  return requireConfigured("Shorts script", p, "SHORTS_SCRIPT_API_KEY");
}

export function getTTSProvider(): TTSProvider {
  const p = process.env.TTS_PROVIDER ?? "mock";
  if (p === "mock") return new MockTTSProvider();
  return requireConfigured("TTS", p, "TTS_API_KEY");
}

export function getVideoCompositorProvider(): VideoCompositorProvider {
  const p = process.env.VIDEO_COMPOSITOR_PROVIDER ?? "mock";
  if (p === "mock") return new MockVideoCompositorProvider();
  return requireConfigured("Video compositor", p, "VIDEO_COMPOSITOR_API_KEY");
}

export function getYouTubePublisher(): YouTubePublisher {
  const p = process.env.YOUTUBE_PUBLISHER ?? "mock";
  if (p === "mock") return new MockYouTubePublisher();
  return requireConfigured("YouTube publisher", p, "YOUTUBE_CLIENT_SECRET");
}
