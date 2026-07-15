"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { createPromptTemplateVersion, setPromptTemplateActive } from "@/domain/prompts";
import type { PROMPT_TEMPLATE_KEYS } from "@/domain/prompts";

function errMsg(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const PATH = "/studio/admin/prompts";

export async function createPromptVersionAction(fd: FormData) {
  const actor = await requireActor();
  let to = PATH;
  try {
    await createPromptTemplateVersion(actor, {
      key: s(fd, "key") as (typeof PROMPT_TEMPLATE_KEYS)[number],
      systemText: s(fd, "systemText"),
      userTemplate: s(fd, "userTemplate"),
      outputSchema: s(fd, "outputSchema"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function setPromptActiveAction(fd: FormData) {
  const actor = await requireActor();
  let to = PATH;
  try {
    await setPromptTemplateActive(actor, s(fd, "id"), s(fd, "active") === "true");
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}
