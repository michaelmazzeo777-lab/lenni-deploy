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
  publishShort,
} from "@/domain/shorts";

function errMsg(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const PATH = "/studio/shorts";

async function run(fn: () => Promise<unknown>) {
  let to = PATH;
  try {
    await fn();
    revalidatePath(PATH);
  } catch (e) {
    to = `${PATH}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function draftShortsScriptAction(fd: FormData) {
  const actor = await requireActor();
  await run(() => draftShortsScript(actor, s(fd, "captureSessionId")));
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
    renderShort(actor, s(fd, "voiceoverId"), s(fd, "attributionText") || "Leonida Field Guide"),
  );
}

export async function reviewRenderAction(fd: FormData) {
  const actor = await requireActor();
  await run(() =>
    reviewRender(
      actor,
      s(fd, "renderId"),
      s(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED",
      s(fd, "notes") || undefined,
    ),
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
