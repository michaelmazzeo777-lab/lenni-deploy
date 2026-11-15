"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { attachCaptureMedia, analyzeHighlights, reviewHighlight } from "@/domain/captureMedia";

const PATH = "/studio/captures";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => (s(fd, k) === "" ? undefined : Number(s(fd, k)));

async function run(fn: () => Promise<unknown>) {
  let to = PATH;
  try {
    await fn();
    revalidatePath(PATH);
  } catch (e) {
    const msg = isDomainError(e) || e instanceof Error ? e.message : "Unexpected error";
    to = `${PATH}?error=${encodeURIComponent(msg)}`;
  }
  redirect(to);
}

export async function attachCaptureMediaAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    attachCaptureMedia(actor, {
      captureSessionId: s(fd, "captureSessionId"),
      fileName: s(fd, "fileName"),
      operator: s(fd, "operator"),
      gameMode: s(fd, "gameMode") || undefined,
      captureMethod: s(fd, "captureMethod") as never,
      sourceDevice: s(fd, "sourceDevice"),
      audioNotes: s(fd, "audioNotes") || undefined,
      rightsStatus: s(fd, "rightsStatus") as never,
    }),
  );
}

export async function analyzeHighlightsAction(fd: FormData) {
  const actor = await requireActor();
  await run(() => analyzeHighlights(actor, s(fd, "captureSessionId")));
}

export async function reviewHighlightAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    reviewHighlight(actor, {
      candidateId: s(fd, "candidateId"),
      decision: s(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED",
      trimStartSec: num(fd, "trimStartSec"),
      trimEndSec: num(fd, "trimEndSec"),
      notes: s(fd, "notes") || undefined,
    }),
  );
}
