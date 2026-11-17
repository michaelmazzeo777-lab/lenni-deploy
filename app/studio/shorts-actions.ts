"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import {
  draftShortsScript,
  synthesizeVoiceover,
  renderShort,
  reviewRender,
  approveRenderVersion,
  publishShort,
} from "@/domain/shorts";

function errMsg(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const PATH = "/studio/shorts";

// Review forms also live on the Library page; they say so with a `back` field.
// Only known pages are accepted, so a form can never redirect elsewhere.
const BACK = new Set([PATH, "/studio/library"]);

async function run(fn: () => Promise<unknown>, back?: string) {
  const base = back && BACK.has(back) ? back : PATH;
  let to = base;
  try {
    await fn();
    revalidatePath(PATH);
    revalidatePath("/studio/library");
  } catch (e) {
    to = `${base}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function draftShortsScriptAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    draftShortsScript(actor, s(fd, "captureSessionId"), {
      highlightCandidateId: s(fd, "highlightCandidateId") || undefined,
      hookText: s(fd, "hookText"),
      lines: s(fd, "lines")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    }),
  );
}

export async function synthesizeVoiceoverAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    synthesizeVoiceover(actor, s(fd, "scriptId"), s(fd, "voiceProfileId") || "default"),
  );
}

export async function renderShortAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    renderShort(
      actor,
      s(fd, "voiceoverId"),
      s(fd, "attributionText") || "Leonida Field Guide",
      s(fd, "format") === "16:9" ? "16:9" : "9:16",
    ),
  );
}

export async function reviewRenderAction(fd: FormData) {
  const actor = await requireActor();
  await run(
    () =>
      reviewRender(
        actor,
        s(fd, "renderId"),
        s(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED",
        s(fd, "notes") || undefined,
      ),
    s(fd, "back"),
  );
}

// The Owner's approval of one exact file: the form sends the SHA-256 prefix
// the approver typed, never a value filled in by the page.
export async function approveRenderVersionAction(fd: FormData) {
  const actor = await requireActor();
  await run(
    () => approveRenderVersion(actor, s(fd, "renderId"), s(fd, "checksumPrefix")),
    s(fd, "back"),
  );
}

export async function publishShortAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    publishShort(actor, {
      renderId: s(fd, "renderId"),
      title: s(fd, "title"),
      description: s(fd, "description"),
      tags: s(fd, "tags")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    }),
  );
}
