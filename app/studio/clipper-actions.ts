"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import {
  approveSessionClip,
  cancelSessionClip,
  reviewSessionClip,
  startSessionClip,
} from "@/domain/sessionClip";

const CAPTURES_PATH = "/studio/captures";
const LIBRARY_PATH = "/studio/library";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => (s(fd, k) === "" ? undefined : Number(s(fd, k)));

async function run(path: string, fn: () => Promise<unknown>) {
  let to = path;
  try {
    await fn();
    revalidatePath(path);
  } catch (e) {
    const msg = isDomainError(e) || e instanceof Error ? e.message : "Unexpected error";
    to = `${path}?error=${encodeURIComponent(msg)}`;
  }
  redirect(to);
}

/** Starts (or retries) the long-session clipper on an approved, ingested capture. */
export async function startSessionClipAction(fd: FormData) {
  const actor = await requireActor();
  await run(CAPTURES_PATH, () =>
    startSessionClip(actor, s(fd, "captureSessionId"), {
      n: num(fd, "n"),
      cropMode: (s(fd, "cropMode") || undefined) as never,
    }),
  );
}

export async function cancelSessionClipAction(fd: FormData) {
  const actor = await requireActor();
  await run(CAPTURES_PATH, () => cancelSessionClip(actor, s(fd, "jobId")));
}

export async function reviewSessionClipAction(fd: FormData) {
  const actor = await requireActor();
  await run(LIBRARY_PATH, () =>
    reviewSessionClip(
      actor,
      s(fd, "clipId"),
      s(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED",
      s(fd, "notes") || undefined,
    ),
  );
}

export async function approveSessionClipAction(fd: FormData) {
  const actor = await requireActor();
  await run(LIBRARY_PATH, () =>
    approveSessionClip(actor, s(fd, "clipId"), s(fd, "checksumPrefix")),
  );
}
