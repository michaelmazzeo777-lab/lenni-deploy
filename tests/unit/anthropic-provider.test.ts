import { describe, it, expect } from "vitest";
import {
  AnthropicAIProvider,
  type AnthropicClientLike,
  type AnthropicMessagesResponse,
} from "@/lib/ai/anthropic-provider";
import { validateContentPacket } from "@/lib/ai/validation";
import { getAIProvider } from "@/lib/ai";
import type { AIExecutionContext } from "@/lib/ai/types";

// Proves the PAID provider's request/response handling and its flow into the
// validation pipeline using a recorded-shape fixture — no key, no network,
// no SDK. The live API call itself remains APPROVAL_REQUIRED and untested
// until Mike approves a key.

const CTX: AIExecutionContext = {
  taskType: "CONTENT_PACKET",
  contentId: "content-1",
  currentAsOf: "2026-07-15",
  allowedSources: [
    {
      id: "src-1",
      title: "Official trailer",
      publisher: "Rockstar Games",
      sourceClass: "OFFICIAL",
      factualAsOfDate: "2026-05-01",
      excerpt: "Trailer shows Leonida locales.",
    },
  ],
  allowedClaims: [
    {
      id: "claim-1",
      statement: "The game is set in the state of Leonida.",
      classification: "CONFIRMED",
      publicWording: "Confirmed: set in Leonida.",
      sourceIds: ["src-1"],
    },
  ],
  prohibitedAssertions: [],
  spoilerLevel: "NONE",
  disclaimer: "Independent fan publication.",
  editorialTone: "Clear, careful, evidence-first.",
  requestedByUserId: "user-1",
  workingTitle: "Leonida setting briefing",
  viewerPromise: "What the trailer actually confirms.",
};

function packetCiting(claimIds: string[]): string {
  return JSON.stringify({
    status: "DRAFT",
    titleOptions: ["Leonida setting briefing"],
    viewerPromise: "What the trailer actually confirms.",
    sourceBoundary: "Grounded in 1 source and 1 claim as of 2026-07-15.",
    outline: ["Setting"],
    scriptDraft: {
      sections: [
        {
          heading: "Setting",
          narration: "Confirmed: set in Leonida.",
          visualNotes: "Original map graphic.",
          claimIds,
        },
      ],
    },
    shorts: [],
    websiteDraft: { summary: "Setting briefing.", sections: [] },
    thumbnailBriefs: [],
    unsupportedStatements: [],
    rumorWarnings: [],
    rightsWarnings: [],
    updateTriggers: [],
  });
}

// Fixture shaped like a real Messages API response: a non-text block that
// must be ignored, the JSON split across two text blocks, and token usage.
function stubClient(rawJson: string, capture?: { lastArgs?: unknown }): AnthropicClientLike {
  const response: AnthropicMessagesResponse = {
    content: [
      { type: "thinking" },
      { type: "text", text: rawJson.slice(0, 40) },
      { type: "text", text: rawJson.slice(40) },
    ],
    usage: { input_tokens: 812, output_tokens: 401 },
  };
  return {
    messages: {
      create: async (args) => {
        if (capture) capture.lastArgs = args;
        return response;
      },
    },
  };
}

describe("AnthropicAIProvider (fixture — no key, no network)", () => {
  it("joins text blocks, ignores non-text blocks, sums tokens, records the configured model", async () => {
    const capture: { lastArgs?: unknown } = {};
    const provider = new AnthropicAIProvider("test-key-never-real", "configured-model-id", () =>
      Promise.resolve(stubClient(packetCiting(["claim-1"]), capture)),
    );
    const result = await provider.generateContentPacket(CTX);

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("configured-model-id"); // actual configured id, not assumed
    expect(result.usage.tokens).toBe(1213);
    expect(JSON.parse(result.rawText).status).toBe("DRAFT");

    // The request carries the grounding prompt, not raw secrets.
    const args = capture.lastArgs as { system: string; messages: { content: string }[] };
    expect(args.system.length).toBeGreaterThan(0);
    expect(args.messages[0]?.content).toContain("claim-1");
  });

  it("feeds the same validation pipeline: well-grounded output is VALID", async () => {
    const provider = new AnthropicAIProvider("test-key-never-real", "configured-model-id", () =>
      Promise.resolve(stubClient(packetCiting(["claim-1"]))),
    );
    const result = await provider.generateContentPacket(CTX);
    const validation = validateContentPacket(result.rawText, {
      sourceIds: ["src-1"],
      claimIds: ["claim-1"],
      leakedClaimIds: [],
    });
    expect(validation.status).toBe("VALID");
  });

  it("invented claim IDs from the paid provider are QUARANTINED, same as mock", async () => {
    const provider = new AnthropicAIProvider("test-key-never-real", "configured-model-id", () =>
      Promise.resolve(stubClient(packetCiting(["claim-invented-999"]))),
    );
    const result = await provider.generateContentPacket(CTX);
    const validation = validateContentPacket(result.rawText, {
      sourceIds: ["src-1"],
      claimIds: ["claim-1"],
      leakedClaimIds: [],
    });
    expect(validation.status).toBe("QUARANTINED");
    expect(validation.reasons.join(" ")).toContain("claim-invented-999");
  });
});

describe("getAIProvider selection", () => {
  it("falls back to mock when AI_PROVIDER=anthropic but no key is set", () => {
    const prevProvider = process.env.AI_PROVIDER;
    const prevKey = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.AI_PROVIDER = "anthropic";
      delete process.env.ANTHROPIC_API_KEY;
      expect(getAIProvider().name).toBe("mock");
    } finally {
      if (prevProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = prevProvider;
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
