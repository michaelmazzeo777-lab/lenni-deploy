import { z } from "zod";

// Structured content-packet schema (docs/05_AI_CONTENT_ENGINE.md).
// AI output MUST validate against this before it may be persisted as a draft.

export const scriptSectionSchema = z.object({
  heading: z.string().min(1),
  narration: z.string().min(1),
  visualNotes: z.string().default(""),
  claimIds: z.array(z.string()).default([]),
});

export const shortSchema = z.object({
  title: z.string().min(1),
  promise: z.string().min(1),
  script: z.string().min(1),
  claimIds: z.array(z.string()).default([]),
});

export const websiteSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  classification: z
    .enum(["CONFIRMED", "OBSERVED", "ANALYSIS", "PREDICTION", "RUMOR", "UNVERIFIED"])
    .optional(),
  claimIds: z.array(z.string()).default([]),
});

export const contentPacketSchema = z.object({
  status: z.literal("DRAFT"),
  titleOptions: z.array(z.string()).default([]),
  viewerPromise: z.string().default(""),
  sourceBoundary: z.string().default(""),
  outline: z.array(z.string()).default([]),
  scriptDraft: z.object({
    sections: z.array(scriptSectionSchema).min(1),
  }),
  shorts: z.array(shortSchema).default([]),
  websiteDraft: z.object({
    summary: z.string().default(""),
    sections: z.array(websiteSectionSchema).default([]),
  }),
  thumbnailBriefs: z.array(z.string()).default([]),
  unsupportedStatements: z.array(z.string()).default([]),
  rumorWarnings: z.array(z.string()).default([]),
  rightsWarnings: z.array(z.string()).default([]),
  updateTriggers: z.array(z.string()).default([]),
});

export type ContentPacket = z.infer<typeof contentPacketSchema>;
export type ScriptSection = z.infer<typeof scriptSectionSchema>;
