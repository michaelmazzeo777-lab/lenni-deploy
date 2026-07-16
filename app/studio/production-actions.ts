"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import {
  createContributor,
  createAssignment,
  submitAssignment,
  reviewAssignment,
  recordRelease,
} from "@/domain/contributors";
import { createShot, submitCapture, reviewCapture } from "@/domain/capture";
import {
  createVisualBrief,
  approveVisualPrompt,
  generateWithMock,
  importVisualResult,
  reviewVisualAsset,
} from "@/domain/visuals";
import { uploadStoredFile, scanStoredFile, discardRejectedFile } from "@/domain/storage";

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

// ---- Contributors ----

export async function createContributorAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/contributors";
  try {
    await createContributor(actor, {
      displayName: s(fd, "displayName"),
      specialty: opt(fd, "specialty"),
      userId: opt(fd, "userId"),
      notes: opt(fd, "notes"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function createAssignmentAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/contributors";
  try {
    await createAssignment(actor, {
      contentId: s(fd, "contentId"),
      contributorId: s(fd, "contributorId"),
      kind: s(fd, "kind") as never,
      dueAt: opt(fd, "dueAt") as never,
      deliverableNotes: opt(fd, "deliverableNotes"),
      releaseRequired: !bool(fd, "releaseNotRequired"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function submitAssignmentAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/contributors";
  try {
    await submitAssignment(actor, s(fd, "assignmentId"), s(fd, "deliverableNotes"));
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewAssignmentAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/contributors";
  try {
    await reviewAssignment(actor, {
      assignmentId: s(fd, "assignmentId"),
      decision: s(fd, "decision") as never,
      reviewNotes: opt(fd, "reviewNotes"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function recordReleaseAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/contributors";
  try {
    await recordRelease(actor, s(fd, "assignmentId"));
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Gameplay production ----

export async function createShotAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=production`;
  try {
    await createShot(actor, {
      contentId: id,
      order: num(fd, "order") ?? 1,
      title: s(fd, "title"),
      description: opt(fd, "description"),
      captureNotes: opt(fd, "captureNotes"),
      spoilerLevel: (opt(fd, "spoilerLevel") ?? "NONE") as never,
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function submitCaptureAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=production`;
  try {
    await submitCapture(actor, {
      contentId: id,
      assignmentId: opt(fd, "assignmentId"),
      shotId: opt(fd, "shotId"),
      platform: s(fd, "platform"),
      gameVersion: s(fd, "gameVersion"),
      settings: opt(fd, "settings"),
      testConditions: opt(fd, "testConditions"),
      trialCount: num(fd, "trialCount"),
      hudVisible: bool(fd, "hudVisible"),
      containsLicensedMusic: bool(fd, "containsLicensedMusic"),
      modsDeclared: bool(fd, "modsDeclared"),
      modsNotes: opt(fd, "modsNotes"),
      fileReference: opt(fd, "fileReference"),
      flagLeaked: bool(fd, "flagLeaked"),
      targetsShorts: bool(fd, "targetsShorts"),
      supersedesId: opt(fd, "supersedesId"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewCaptureAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=production`;
  try {
    await reviewCapture(actor, {
      captureId: s(fd, "captureId"),
      decision: s(fd, "decision") as never,
      reviewNotes: opt(fd, "reviewNotes"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Visual production ----

export async function createVisualBriefAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=visuals`;
  try {
    await createVisualBrief(actor, {
      contentId: id,
      kind: s(fd, "kind") as never,
      title: s(fd, "title"),
      prompt: s(fd, "prompt"),
      negativePrompt: opt(fd, "negativePrompt"),
      styleNotes: opt(fd, "styleNotes"),
      costCeiling: num(fd, "costCeiling") ?? 0,
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function approveVisualPromptAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=visuals`;
  try {
    await approveVisualPrompt(actor, s(fd, "briefId"), num(fd, "costCeiling"));
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function generateMockVisualAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=visuals`;
  try {
    await generateWithMock(actor, s(fd, "briefId"));
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function importVisualResultAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=visuals`;
  try {
    await importVisualResult(actor, {
      briefId: s(fd, "briefId"),
      provider: s(fd, "provider"),
      model: s(fd, "model"),
      jobId: opt(fd, "jobId"),
      cost: num(fd, "cost") ?? 0,
      location: opt(fd, "location"),
      realismClassification: (opt(fd, "realismClassification") ?? "ORIGINAL_GRAPHIC") as never,
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function reviewVisualAssetAction(fd: FormData) {
  const actor = await requireActor();
  const id = s(fd, "contentId");
  let to = `/studio/content/${id}?tab=visuals`;
  try {
    await reviewVisualAsset(actor, {
      assetId: s(fd, "assetId"),
      decision: s(fd, "decision") as never,
      disclosureDecision: s(fd, "disclosureDecision") as never,
      reviewNotes: opt(fd, "reviewNotes"),
      rejectionReason: opt(fd, "rejectionReason"),
      finalUsage: opt(fd, "finalUsage"),
    });
    revalidatePath(`/studio/content/${id}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

// ---- Local file storage ----

export async function uploadAssetFileAction(fd: FormData) {
  const actor = await requireActor();
  const contentId = s(fd, "contentId");
  const assetId = s(fd, "assetId");
  let to = `/studio/content/${contentId}?tab=assets`;
  try {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a file to upload");
    }
    const data = Buffer.from(await file.arrayBuffer());
    await uploadStoredFile(actor, {
      ownerType: "asset",
      ownerId: assetId,
      filename: file.name,
      mediaType: file.type || "application/octet-stream",
      data,
    });
    revalidatePath(`/studio/content/${contentId}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function scanStoredFileAction(fd: FormData) {
  const actor = await requireActor();
  const contentId = s(fd, "contentId");
  const tab = opt(fd, "tab") ?? "assets";
  let to = `/studio/content/${contentId}?tab=${tab}`;
  try {
    await scanStoredFile(actor, s(fd, "storedFileId"));
    revalidatePath(`/studio/content/${contentId}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function discardRejectedFileAction(fd: FormData) {
  const actor = await requireActor();
  const contentId = s(fd, "contentId");
  const tab = opt(fd, "tab") ?? "assets";
  let to = `/studio/content/${contentId}?tab=${tab}`;
  try {
    await discardRejectedFile(actor, s(fd, "storedFileId"));
    revalidatePath(`/studio/content/${contentId}`);
  } catch (e) {
    to = `${to}&error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}
