import { prisma } from "@/lib/db";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import type { CanonicalClass } from "@/domain/canonicalTaxonomy";

// Can a capture stand as evidence for a canonical OBSERVED_IN_GAME claim?
//
// Adapted from the Gemini v3.1 candidate's canPromoteToObservedInGame(), which
// judged an object handed to it by the caller (so `captureStatus: "APPROVED"`
// or a reviewer id typed into JSON was enough). This version takes only a
// capture id and reads every fact from the Studio's own records: the review
// decision, the reviewer's account and role, and the ingested file's hash.
//
// It is read-only. It never changes a claim's stored class, and a positive
// answer is an eligibility finding for a human editor, not an approval.

export interface ObservedInGameEvidence {
  captureSessionId: string;
  checksumSha256: string;
  platform: string;
  gameVersion: string;
  gameMode: string;
  captureDate: string;
  captureMethod: string;
  settings: string;
  testConditions: string;
  operator: string;
  submittedBy: string;
  reviewedBy: string;
}

export interface ObservedInGameFinding {
  eligible: boolean;
  /** Class the evidence can support. Never OBSERVED_IN_GAME unless eligible. */
  supports: CanonicalClass;
  missing: string[];
  evidence: ObservedInGameEvidence | null;
  limitations: string[];
}

const LIMITATIONS = [
  "Shows what one operator recorded on one platform, build and date; it does not generalize.",
  "The Studio cannot confirm the footage is retail GTA VI gameplay; the reviewer attests to that.",
  "Eligibility is not approval: an editor must still classify the claim.",
];

export async function assessObservedInGameEvidence(
  actor: Actor,
  captureSessionId: string,
): Promise<ObservedInGameFinding> {
  require_(actor, "capture.review");
  const capture = await prisma.captureSession.findUnique({
    where: { id: captureSessionId },
    include: { content: true, media: true },
  });
  if (!capture || capture.content.workspaceId !== actor.workspaceId) {
    throw notFound("Capture session not found");
  }
  const media = capture.media;
  const missing: string[] = [];

  if (capture.flagLeaked) missing.push("capture is flagged as leaked material");
  if (capture.status !== "APPROVED") missing.push("capture review decision is not APPROVED");
  if (capture.modsDeclared) missing.push("mods were declared for this capture");

  // The approval must belong to a real, active reviewer account in this
  // workspace who did not submit the capture themselves.
  const reviewer = capture.reviewedBy
    ? await prisma.user.findFirst({
        where: { id: capture.reviewedBy, workspaceId: actor.workspaceId, status: "ACTIVE" },
        include: { roles: true },
      })
    : null;
  if (!reviewer) {
    missing.push("no active reviewer account is recorded on the capture");
  } else {
    if (!reviewer.roles.some((r) => r.role === "OWNER" || r.role === "EDITOR")) {
      missing.push("the recorded reviewer no longer holds a reviewing role");
    }
    if (reviewer.id === capture.submittedBy) {
      missing.push("the capture was reviewed by the person who submitted it");
    }
  }

  if (!media) {
    missing.push("no ingested video file (and therefore no file hash) is attached");
  } else {
    if (media.captureMethod === "SYNTHETIC_FIXTURE" || media.rightsStatus === "INTERNAL_FIXTURE") {
      missing.push("the footage is an internal fixture, not gameplay");
    }
    if (media.rightsStatus !== "OWNED_ORIGINAL_CAPTURE") {
      missing.push("footage rights are not recorded as an owned original capture");
    }
    if (!/^[0-9a-f]{64}$/.test(media.checksumSha256)) missing.push("file SHA-256 is not recorded");
    if (!media.gameMode?.trim()) missing.push("game mode is not recorded");
    if (!media.operator.trim()) missing.push("operator is not recorded");
  }
  if (!capture.platform.trim()) missing.push("platform is not recorded");
  if (!capture.gameVersion.trim()) missing.push("game version/build is not recorded");
  if (!capture.settings?.trim()) missing.push("game settings are not recorded");
  if (!capture.testConditions?.trim()) missing.push("test method/conditions are not recorded");

  const eligible = missing.length === 0;
  return {
    eligible,
    supports: eligible ? "OBSERVED_IN_GAME" : "UNKNOWN",
    missing,
    evidence:
      eligible && media
        ? {
            captureSessionId: capture.id,
            checksumSha256: media.checksumSha256,
            platform: capture.platform,
            gameVersion: capture.gameVersion,
            gameMode: media.gameMode ?? "",
            captureDate: capture.captureDate.toISOString(),
            captureMethod: media.captureMethod,
            settings: capture.settings ?? "",
            testConditions: capture.testConditions ?? "",
            operator: media.operator,
            submittedBy: capture.submittedBy,
            reviewedBy: capture.reviewedBy ?? "",
          }
        : null,
    limitations: LIMITATIONS,
  };
}
