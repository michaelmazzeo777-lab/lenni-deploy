"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { createContent } from "@/domain/content";
import { transition } from "@/domain/workflow";
import { createSource, createClaim, reviewClaim, linkClaimToContent } from "@/domain/evidence";
import { saveScriptVersion } from "@/domain/script";
import { createAsset, reviewAsset } from "@/domain/rights";
import { createTitleVariant, createThumbnailVariant } from "@/domain/packaging";
import { grantApproval } from "@/domain/approval";
import { generateContentPacket, reviewGeneration } from "@/domain/aiContent";
import { publishPublicArticle } from "@/domain/publication";
import { createCorrection } from "@/domain/correction";
import type {
  ContentStatus,
  ApprovalScope,
  ApprovalDecision,
  AIReviewDecision,
} from "@prisma/client";

function errMsg(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v.length ? v : undefined;
};
const num = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v.length ? Number(v) : undefined;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

// ---- Content ----

export async function createContentAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/content";
  try {
    const c = await createContent(actor, {
      type: s(fd, "type") as never,
      pillar: s(fd, "pillar") as never,
      workingTitle: s(fd, "workingTitle"),
      viewerPromise: opt(fd, "viewerPromise"),
      spoilerLevel: (opt(fd, "spoilerLevel") ?? "NONE") as never,
    });
    to = `/studio/content/${c.id}`;
    revalidatePath("/studio/content");
  } catch (e) {
    to = `/studio/content?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function transitionAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}`;
  try {
    await transition(actor, id, s(fd, "to") as ContentStatus, {
      reason: opt(fd, "reason"),
      override: bool(fd, "override"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?tab=overview&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Evidence ----

export async function createSourceAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/sources";
  try {
    await createSource(actor, {
      title: s(fd, "title"),
      publisher: s(fd, "publisher"),
      url: opt(fd, "url"),
      sourceClass: s(fd, "sourceClass") as never,
      sourceType: s(fd, "sourceType") || "web",
      supportNotes: opt(fd, "supportNotes"),
      factualAsOfDate: opt(fd, "factualAsOfDate") as never,
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function createClaimAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/claims";
  try {
    const sourceIds = fd
      .getAll("sourceIds")
      .map((v) => String(v))
      .filter(Boolean);
    await createClaim(actor, {
      statement: s(fd, "statement"),
      classification: s(fd, "classification") as never,
      confidence: num(fd, "confidence") ?? 3,
      publicWording: opt(fd, "publicWording"),
      sourceIds,
      supportText: opt(fd, "supportText"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewClaimAction(fd: FormData) {
  const actor = await requireActor();
  const back = s(fd, "back") || "/studio/claims";
  let to = back;
  try {
    await reviewClaim(actor, s(fd, "claimId"));
    revalidatePath(back);
  } catch (e) {
    to = `${back}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function linkClaimAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=evidence`;
  try {
    await linkClaimToContent(actor, id, s(fd, "claimId"), bool(fd, "required"));
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Script ----

export async function saveScriptAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=script`;
  try {
    await saveScriptVersion(actor, { contentId: id, body: s(fd, "body") });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Rights / assets ----

export async function createAssetAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=assets`;
  try {
    await createAsset(actor, {
      contentId: id,
      name: s(fd, "name"),
      mediaType: s(fd, "mediaType") || "image",
      ownership: s(fd, "ownership") as never,
      ownerName: opt(fd, "ownerName"),
      intendedUse: opt(fd, "intendedUse"),
      licenseBasis: opt(fd, "licenseBasis"),
      containsMusic: bool(fd, "containsMusic"),
      flagLeaked: bool(fd, "flagLeaked"),
      flagFakeTrailer: bool(fd, "flagFakeTrailer"),
      flagIsolatedCutscene: bool(fd, "flagIsolatedCutscene"),
      flagUnlicensedMusic: bool(fd, "flagUnlicensedMusic"),
      flagMassProducedAI: bool(fd, "flagMassProducedAI"),
      flagDeceptive: bool(fd, "flagDeceptive"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewAssetAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=assets`;
  try {
    await reviewAsset(actor, {
      assetId: s(fd, "assetId"),
      riskLevel: s(fd, "riskLevel") as never,
      decision: s(fd, "decision") as never,
      notes: opt(fd, "notes"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Packaging ----

export async function createTitleAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=packaging`;
  try {
    await createTitleVariant(actor, {
      contentId: id,
      text: s(fd, "text"),
      strategy: opt(fd, "strategy") as never,
      classificationBadge: opt(fd, "classificationBadge"),
      deceptionCheck: bool(fd, "deceptionCheck"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function createThumbnailAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=packaging`;
  try {
    await createThumbnailVariant(actor, {
      contentId: id,
      name: s(fd, "name"),
      brief: s(fd, "brief"),
      strategy: opt(fd, "strategy") as never,
      mobileCheck: bool(fd, "mobileCheck"),
      deceptionCheck: bool(fd, "deceptionCheck"),
      trademarkCheck: bool(fd, "trademarkCheck"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- AI ----

export async function generateAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=ai`;
  try {
    const sourceIds = fd.getAll("sourceIds").map(String).filter(Boolean);
    const claimIds = fd.getAll("claimIds").map(String).filter(Boolean);
    const { generation } = await generateContentPacket(actor, {
      contentId: id,
      sourceIds,
      claimIds,
    });
    to = `${to}&gen=${generation.id}`;
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewGenerationAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=ai`;
  try {
    await reviewGeneration(
      actor,
      s(fd, "generationId"),
      s(fd, "decision") as AIReviewDecision,
      opt(fd, "notes"),
    );
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Approvals ----

export async function grantApprovalAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=approvals`;
  try {
    await grantApproval(
      actor,
      id,
      s(fd, "scope") as ApprovalScope,
      s(fd, "decision") as ApprovalDecision,
      opt(fd, "notes"),
    );
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Publication ----

export async function publishAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=publication`;
  try {
    const { revision } = await publishPublicArticle(actor, id);
    to = `${to}&published=${revision.slug}`;
    revalidatePath(`/studio/content/${id}`);
    revalidatePath("/", "layout");
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Corrections ----

export async function createCorrectionAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=corrections`;
  try {
    await createCorrection(actor, {
      contentId: id,
      severity: s(fd, "severity") as never,
      originalText: s(fd, "originalText"),
      correctedText: s(fd, "correctedText"),
      reason: s(fd, "reason"),
      publicNotice: s(fd, "publicNotice"),
    });
    revalidatePath(`/studio/content/${id}`);
    revalidatePath("/", "layout");
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}
