import type { AIProvider, AIExecutionContext, AIResult } from "@/lib/ai/types";
import type { ContentPacket } from "@/lib/ai/schema";

// Deterministic mock provider: identical input -> identical output. No network,
// no key. Grounds every section in the allowed claim IDs (docs/11 test 25/26).

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateContentPacket(ctx: AIExecutionContext): Promise<AIResult> {
    const claims = ctx.allowedClaims;
    const allClaimIds = claims.map((c) => c.id);

    const sections = [
      {
        heading: "Source boundary and promise",
        narration:
          `This ${ctx.spoilerLevel} briefing keeps to official evidence only. ` +
          `${ctx.viewerPromise || "We answer the question directly, then show the evidence."}`,
        visualNotes: "Channel title card (original graphic). No Rockstar logos.",
        claimIds: allClaimIds,
      },
      ...claims.map((c) => ({
        heading: truncate(c.statement, 60),
        narration:
          `${c.classification}: ${c.publicWording ?? c.statement} ` + `Grounded in claim ${c.id}.`,
        visualNotes: "Original chart or on-screen text. Cite source in lower third.",
        claimIds: [c.id],
      })),
      {
        heading: "What is not confirmed",
        narration:
          "Everything above is labeled by evidence type. Predictions and analysis are " +
          "editorial and clearly separated from confirmed facts.",
        visualNotes: "Classification key card (original design).",
        claimIds: allClaimIds,
      },
    ];

    const packet: ContentPacket = {
      status: "DRAFT",
      titleOptions: [
        truncate(ctx.workingTitle, 70),
        `${truncate(ctx.workingTitle, 50)} — Official Evidence Only`,
      ],
      viewerPromise: ctx.viewerPromise || "Direct answer plus the evidence behind it.",
      sourceBoundary: `Grounded only in ${ctx.allowedSources.length} source(s) and ${claims.length} claim(s), as of ${ctx.currentAsOf}.`,
      outline: sections.map((s) => s.heading),
      scriptDraft: { sections },
      shorts: claims.slice(0, 3).map((c) => ({
        title: truncate(c.statement, 50),
        promise: `One fact: ${truncate(c.publicWording ?? c.statement, 60)}`,
        script: `${c.classification}. ${c.publicWording ?? c.statement} (claim ${c.id}).`,
        claimIds: [c.id],
      })),
      websiteDraft: {
        summary: `An evidence-graded look at "${truncate(ctx.workingTitle, 60)}", current as of ${ctx.currentAsOf}.`,
        sections: claims.map((c) => ({
          heading: truncate(c.statement, 60),
          body: c.publicWording ?? c.statement,
          classification: ([
            "CONFIRMED",
            "OBSERVED",
            "ANALYSIS",
            "PREDICTION",
            "RUMOR",
            "UNVERIFIED",
          ].includes(c.classification)
            ? c.classification
            : undefined) as ContentPacket["websiteDraft"]["sections"][number]["classification"],
          claimIds: [c.id],
        })),
      },
      thumbnailBriefs: [
        "Original channel graphic; large legible text; no trailer stills; no Rockstar marks.",
      ],
      unsupportedStatements: [],
      rumorWarnings: claims
        .filter((c) => c.classification === "RUMOR")
        .map((c) => `Rumor: ${c.statement}`),
      rightsWarnings: [
        "Use only original graphics and lawfully captured post-release screenshots. No leaked footage.",
      ],
      updateTriggers: [
        "Re-verify when Rockstar publishes new official information or a platform/date changes.",
      ],
    };

    return {
      provider: this.name,
      model: "mock-deterministic-1",
      rawText: JSON.stringify(packet),
      usage: { tokens: 0, estimatedCost: 0 },
    };
  }
}
