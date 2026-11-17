"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { cancelPremiumRender, startPremiumRender } from "@/domain/premiumRender";

const PATH = "/studio/shorts";
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

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

/** Starts or retries the premium render (both formats) of a narrated explainer. Returns at once. */
export async function startPremiumRenderAction(fd: FormData) {
  const actor = await requireActor();
  await run(() => startPremiumRender(actor, s(fd, "voiceoverId")));
}

export async function cancelPremiumRenderAction(fd: FormData) {
  const actor = await requireActor();
  await run(() => cancelPremiumRender(actor, s(fd, "jobId")));
}
