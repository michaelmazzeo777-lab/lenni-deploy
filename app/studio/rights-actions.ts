"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import {
  createAgreementDraft,
  createCreator,
  linkMediaToAgreement,
  qualifyCreator,
  reviewMediaRights,
  transitionAgreement,
  updateAgreementTerms,
} from "@/domain/creatorRights";
import type { AgreementStatus } from "@prisma/client";

const PATH = "/studio/rights";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (fd: FormData, k: string) =>
  s(fd, k)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const date = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k)) : undefined);
const opt = (fd: FormData, k: string) => s(fd, k) || undefined;

async function run(fn: () => Promise<unknown>, ok?: string) {
  let to = PATH;
  try {
    await fn();
    revalidatePath(PATH);
    revalidatePath("/studio/library");
    if (ok) to = `${PATH}?ok=${encodeURIComponent(ok)}`;
  } catch (e) {
    const msg = isDomainError(e) || e instanceof Error ? e.message : "Unexpected error";
    to = `${PATH}?error=${encodeURIComponent(msg)}`;
  }
  redirect(to);
}

export async function createCreatorAction(fd: FormData) {
  const actor = await requireActor();
  await run(
    () =>
      createCreator(actor, {
        name: s(fd, "name"),
        platform: s(fd, "platform") as never,
        profileUrl: s(fd, "profileUrl"),
        tier: (opt(fd, "tier") as never) ?? undefined,
        games: list(fd, "games"),
        categories: list(fd, "categories"),
        audienceNote: opt(fd, "audienceNote"),
        audienceSource: opt(fd, "audienceSource"),
        businessContact: opt(fd, "businessContact"),
        contactSource: opt(fd, "contactSource"),
        fitNotes: opt(fd, "fitNotes"),
        rightsComplications: opt(fd, "rightsComplications"),
        sourceUrl: s(fd, "sourceUrl"),
        retrievedAt: date(fd, "retrievedAt") ?? new Date(),
        confidence: s(fd, "confidence") as never,
        nextAction: opt(fd, "nextAction"),
      }),
    "Creator recorded as a prospect. Nobody has been contacted.",
  );
}

export async function qualifyCreatorAction(fd: FormData) {
  const actor = await requireActor();
  await run(() => qualifyCreator(actor, s(fd, "creatorId"), s(fd, "evidence")));
}

export async function createAgreementDraftAction(fd: FormData) {
  const actor = await requireActor();
  await run(
    () =>
      createAgreementDraft(actor, s(fd, "creatorId"), {
        footageScope: opt(fd, "footageScope"),
        approvedDestinations: list(fd, "approvedDestinations") as never,
        editingAllowed: fd.get("editingAllowed") === "on",
        derivativesAllowed: fd.get("derivativesAllowed") === "on",
        commercialUse: fd.get("commercialUse") === "on",
        monetizationAllowed: fd.get("monetizationAllowed") === "on",
        attribution: opt(fd, "attribution"),
        compensationTerms: opt(fd, "compensationTerms"),
        expiresAt: date(fd, "expiresAt") ?? null,
      }),
    "Draft created. It has not been sent to anyone.",
  );
}

export async function updateTermsAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    updateAgreementTerms(actor, s(fd, "agreementId"), {
      rightsOwner: opt(fd, "rightsOwner"),
      ownershipEvidence: opt(fd, "ownershipEvidence"),
      footageScope: opt(fd, "footageScope"),
      approvedDestinations: list(fd, "approvedDestinations") as never,
      editingAllowed: fd.get("editingAllowed") === "on",
      derivativesAllowed: fd.get("derivativesAllowed") === "on",
      commercialUse: fd.get("commercialUse") === "on",
      monetizationAllowed: fd.get("monetizationAllowed") === "on",
      attribution: opt(fd, "attribution"),
      compensationTerms: opt(fd, "compensationTerms"),
      excludedRights: opt(fd, "excludedRights"),
    }),
  );
}

export async function transitionAgreementAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    transitionAgreement(
      actor,
      s(fd, "agreementId"),
      s(fd, "to") as AgreementStatus,
      s(fd, "evidence"),
      {
        legalReviewer: opt(fd, "legalReviewer"),
        legalReviewNote: opt(fd, "legalReviewNote"),
        signatureEvidence: opt(fd, "signatureEvidence"),
        effectiveAt: date(fd, "effectiveAt"),
        expiresAt: date(fd, "expiresAt"),
      },
    ),
  );
}

export async function linkMediaAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    linkMediaToAgreement(
      actor,
      s(fd, "captureMediaId"),
      s(fd, "agreementId") || null,
      s(fd, "thirdPartyNotes"),
    ),
  );
}

export async function reviewMediaRightsAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    reviewMediaRights(
      actor,
      s(fd, "captureMediaId"),
      s(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED",
      s(fd, "note"),
    ),
  );
}
