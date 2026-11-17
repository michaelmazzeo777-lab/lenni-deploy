// Creator partnerships and footage rights: internal records with an audit
// trail. Nothing here contacts a creator, sends or signs a document, or makes
// any asset publishable on its own (see lib/rights/clearance.ts).
import { z } from "zod";
import { Role, type AgreementStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { effectiveStatus, TERMS_EDITABLE, transitionProblems } from "@/lib/rights/agreements";

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith("https://"), "Must be an https:// link");
const optText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) => (v ? v : null));
const PLATFORMS = [
  "youtube",
  "twitch",
  "kick",
  "tiktok",
  "instagram",
  "facebook",
  "other",
] as const;

export const creatorInput = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.enum(PLATFORMS),
  profileUrl: httpsUrl,
  tier: z.enum(["HIGH_PROFILE", "REALISTIC_PARTNER"]).optional(),
  games: z.array(z.string().trim().min(1)).max(20).default([]),
  categories: z.array(z.string().trim().min(1)).max(20).default([]),
  audienceNote: optText,
  audienceSource: optText,
  businessContact: optText,
  contactSource: optText,
  fitNotes: optText,
  rightsComplications: optText,
  sourceUrl: httpsUrl,
  retrievedAt: z.coerce.date(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  nextAction: optText,
});

/** Records a prospect found in public research. Contacting them is a separate, manual decision. */
export async function createCreator(actor: Actor, raw: z.input<typeof creatorInput>) {
  require_(actor, "rights.review");
  const d = creatorInput.parse(raw);
  if (d.businessContact && !d.contactSource) {
    throw precondition("A business contact needs the public page where the creator published it");
  }
  const creator = await prisma.creator.create({
    data: { ...d, workspaceId: actor.workspaceId, createdBy: actor.userId },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "rights.creator_recorded",
    entityType: "Creator",
    entityId: creator.id,
    metadata: { name: d.name, platform: d.platform, sourceUrl: d.sourceUrl },
  });
  return creator;
}

export async function qualifyCreator(actor: Actor, creatorId: string, evidence: string) {
  require_(actor, "rights.review");
  const c = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!c || c.workspaceId !== actor.workspaceId) throw notFound("Creator not found");
  if (c.status !== "PROSPECT") throw precondition("This creator is already qualified");
  if (evidence.trim().length < 10) throw precondition("Record why this creator qualifies");
  const updated = await prisma.creator.update({
    where: { id: creatorId },
    data: { status: "QUALIFIED", qualifiedEvidence: evidence.trim() },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "rights.creator_qualified",
    entityType: "Creator",
    entityId: creatorId,
    metadata: { evidence: evidence.trim() },
  });
  return updated;
}

export const termsInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  rightsOwner: optText,
  ownershipEvidence: optText,
  footageScope: optText,
  editingAllowed: z.boolean().optional(),
  derivativesAllowed: z.boolean().optional(),
  approvedDestinations: z.array(z.enum(PLATFORMS)).optional(),
  commercialUse: z.boolean().optional(),
  monetizationAllowed: z.boolean().optional(),
  attribution: optText,
  compensationTerms: optText,
  excludedRights: optText,
  effectiveAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

/** Starts a draft from the template. A draft is not an offer and is never sent by the Studio. */
export async function createAgreementDraft(
  actor: Actor,
  creatorId: string,
  raw: z.input<typeof termsInput>,
) {
  require_(actor, "rights.review");
  const c = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!c || c.workspaceId !== actor.workspaceId) throw notFound("Creator not found");
  if (c.status !== "QUALIFIED")
    throw precondition("Qualify the creator before drafting an agreement");
  const t = termsInput.parse(raw);
  const agreement = await prisma.creatorAgreement.create({
    data: {
      ...t,
      title: t.title ?? `Footage licence - ${c.name}`,
      approvedDestinations: t.approvedDestinations ?? [],
      templateVersion: "creator-footage-licence-draft-v1",
      excludedRights:
        t.excludedRights ??
        "Third-party music, Rockstar/Take-Two rights, voices and other material the creator does not own",
      workspaceId: actor.workspaceId,
      creatorId,
      createdBy: actor.userId,
    },
  });
  await prisma.agreementEvent.create({
    data: {
      agreementId: agreement.id,
      toStatus: "AGREEMENT_DRAFT",
      evidence: "Draft created from template creator-footage-licence-draft-v1",
      actorId: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "rights.agreement_drafted",
    entityType: "CreatorAgreement",
    entityId: agreement.id,
    metadata: { creatorId },
  });
  return agreement;
}

async function loadAgreement(actor: Actor, id: string) {
  const a = await prisma.creatorAgreement.findUnique({ where: { id } });
  if (!a || a.workspaceId !== actor.workspaceId) throw notFound("Agreement not found");
  return a;
}

export async function updateAgreementTerms(
  actor: Actor,
  agreementId: string,
  raw: z.input<typeof termsInput>,
) {
  require_(actor, "rights.review");
  const a = await loadAgreement(actor, agreementId);
  if (!TERMS_EDITABLE.includes(a.status)) {
    throw precondition("Terms can only change while the agreement is a draft or in negotiation");
  }
  const t = termsInput.parse(raw);
  const updated = await prisma.creatorAgreement.update({ where: { id: agreementId }, data: t });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "rights.agreement_terms_changed",
    entityType: "CreatorAgreement",
    entityId: agreementId,
    metadata: { fields: Object.keys(t) },
  });
  return updated;
}

export const stepFields = z.object({
  legalReviewer: optText,
  legalReviewNote: optText,
  signatureEvidence: optText,
  effectiveAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

/** Assets that use footage under this agreement, for an expiry or revocation record. */
async function affectedAssets(agreementId: string) {
  const media = await prisma.captureMedia.findMany({
    where: { agreementId },
    select: { id: true, captureSessionId: true, originalName: true },
  });
  const clips = await prisma.sessionClip.findMany({
    where: { captureSessionId: { in: media.map((m) => m.captureSessionId) } },
    select: { id: true, format: true, reviewState: true, checksumSha256: true },
  });
  const renders = await prisma.shortsRender.findMany({
    where: { script: { captureSessionId: { in: media.map((m) => m.captureSessionId) } } },
    select: { id: true, format: true, status: true, checksumSha256: true },
  });
  return { media, clips, renders };
}

/**
 * Records one lifecycle step with its evidence. Expiry and revocation record
 * every affected asset; files already exported or published elsewhere cannot
 * be recalled by the Studio and are flagged for Mike to resolve.
 */
export async function transitionAgreement(
  actor: Actor,
  agreementId: string,
  to: AgreementStatus,
  evidence: string,
  rawFields: z.input<typeof stepFields> = {},
  now = new Date(),
) {
  require_(actor, "rights.review");
  const a = await loadAgreement(actor, agreementId);
  const f = stepFields.parse(rawFields);
  const merged = {
    ...a,
    legalReviewer: f.legalReviewer ?? a.legalReviewer,
    legalReviewNote: f.legalReviewNote ?? a.legalReviewNote,
    signatureEvidence: f.signatureEvidence ?? a.signatureEvidence,
    effectiveAt: f.effectiveAt !== undefined ? f.effectiveAt : a.effectiveAt,
    expiresAt: f.expiresAt !== undefined ? f.expiresAt : a.expiresAt,
    legalReviewedAt: to === "APPROVED_TO_CONTACT" ? (a.legalReviewedAt ?? now) : a.legalReviewedAt,
  };
  const problems = transitionProblems(merged, to, evidence, {
    isOwner: actor.roles.includes(Role.OWNER),
    now,
  });
  if (problems.length) throw precondition(problems.join("; "));
  const from = effectiveStatus(a, now);
  const affected = to === "REVOKED" || to === "EXPIRED" ? await affectedAssets(agreementId) : null;
  const { count } = await prisma.creatorAgreement.updateMany({
    where: { id: agreementId, status: a.status, updatedAt: a.updatedAt },
    data: {
      status: to,
      legalReviewer: merged.legalReviewer,
      legalReviewNote: merged.legalReviewNote,
      legalReviewedAt: merged.legalReviewedAt,
      signatureEvidence: merged.signatureEvidence,
      effectiveAt: merged.effectiveAt,
      expiresAt: merged.expiresAt,
      ...(to === "REVOKED" ? { revokedAt: now, revocationReason: evidence.trim() } : {}),
    },
  });
  if (count === 0)
    throw precondition("The agreement changed while you were editing; reload and try again");
  await prisma.agreementEvent.create({
    data: {
      agreementId,
      fromStatus: from,
      toStatus: to,
      evidence: evidence.trim(),
      actorId: actor.userId,
      affectedJson: affected ? (affected as object) : undefined,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: `rights.agreement_${to.toLowerCase()}`,
    entityType: "CreatorAgreement",
    entityId: agreementId,
    metadata: {
      from,
      to,
      evidence: evidence.trim(),
      affectedClips: affected?.clips.length ?? 0,
      affectedRenders: affected?.renders.length ?? 0,
    },
  });
  return prisma.creatorAgreement.findUniqueOrThrow({ where: { id: agreementId } });
}

/** Records the expiry of every ACTIVE agreement past its end date. Safe to call often. */
export async function expireDueAgreements(actor: Actor, now = new Date()) {
  const due = await prisma.creatorAgreement.findMany({
    where: { workspaceId: actor.workspaceId, status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, expiresAt: true },
  });
  for (const a of due) {
    const affected = await affectedAssets(a.id);
    const { count } = await prisma.creatorAgreement.updateMany({
      where: { id: a.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    if (!count) continue;
    const evidence = `Reached its expiry date ${a.expiresAt!.toISOString().slice(0, 10)} (recorded automatically)`;
    await prisma.agreementEvent.create({
      data: {
        agreementId: a.id,
        fromStatus: "ACTIVE",
        toStatus: "EXPIRED",
        evidence,
        actorId: actor.userId,
        affectedJson: affected as object,
      },
    });
    await writeAudit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: "rights.agreement_expired",
      entityType: "CreatorAgreement",
      entityId: a.id,
      metadata: { evidence, affectedClips: affected.clips.length },
    });
  }
  return due.length;
}

/** Attaches a creator agreement and rights notes to an ingested recording. */
export async function linkMediaToAgreement(
  actor: Actor,
  captureMediaId: string,
  agreementId: string | null,
  thirdPartyNotes?: string,
) {
  require_(actor, "rights.review");
  const m = await prisma.captureMedia.findUnique({ where: { id: captureMediaId } });
  if (!m || m.workspaceId !== actor.workspaceId) throw notFound("Recording not found");
  if (agreementId) {
    const a = await loadAgreement(actor, agreementId);
    if (a.status === "REJECTED") throw precondition("A rejected agreement cannot cover footage");
  }
  const updated = await prisma.captureMedia.update({
    where: { id: captureMediaId },
    data: {
      agreementId,
      // A new link needs a new human rights review.
      rightsReviewDecision: null,
      rightsReviewNote: null,
      rightsReviewedBy: null,
      rightsReviewedAt: null,
      ...(thirdPartyNotes !== undefined ? { thirdPartyNotes: thirdPartyNotes.trim() || null } : {}),
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "rights.media_linked",
    entityType: "CaptureMedia",
    entityId: captureMediaId,
    metadata: { agreementId },
  });
  return updated;
}

/** A person's rights review of one recording. Required (but not sufficient) for external delivery. */
export async function reviewMediaRights(
  actor: Actor,
  captureMediaId: string,
  decision: "APPROVED" | "REJECTED",
  note: string,
) {
  require_(actor, "rights.review");
  const m = await prisma.captureMedia.findUnique({
    where: { id: captureMediaId },
    include: { agreement: true },
  });
  if (!m || m.workspaceId !== actor.workspaceId) throw notFound("Recording not found");
  if (note.trim().length < 10) throw precondition("Record the reasoning for this rights decision");
  if (decision === "APPROVED") {
    if (m.rightsStatus === "INTERNAL_FIXTURE")
      throw precondition("A test fixture cannot be rights-approved");
    if (m.rightsStatus === "UNCLEARED" && !m.agreement)
      throw precondition("Uncleared footage needs a linked creator agreement first");
    if (m.agreement && effectiveStatus(m.agreement, new Date()) !== "ACTIVE")
      throw precondition("The linked agreement is not active");
  }
  const updated = await prisma.captureMedia.update({
    where: { id: captureMediaId },
    data: {
      rightsReviewDecision: decision,
      rightsReviewNote: note.trim(),
      rightsReviewedBy: actor.userId,
      rightsReviewedAt: new Date(),
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: decision === "APPROVED" ? "rights.media_approved" : "rights.media_rejected",
    entityType: "CaptureMedia",
    entityId: captureMediaId,
    metadata: { note: note.trim() },
  });
  return updated;
}
