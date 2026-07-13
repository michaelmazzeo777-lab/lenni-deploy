import type { AIProvider } from "@/lib/ai/types";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { AnthropicAIProvider } from "@/lib/ai/anthropic-provider";

export * from "@/lib/ai/types";
export * from "@/lib/ai/schema";
export * from "@/lib/ai/validation";

// Provider selection via server-side config only. Deny-by-default: an explicit
// AI_ENABLED=false disables generation entirely (owner kill switch).
export function isAIEnabled(): boolean {
  return process.env.AI_ENABLED !== "false";
}

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (key && key.length > 0) {
      return new AnthropicAIProvider(key, process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5");
    }
    // Missing key must NOT break demo/test mode — fall back to mock.
    return new MockAIProvider();
  }
  return new MockAIProvider();
}
