"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { importAnalyticsSnapshot } from "@/domain/analytics";
import { assignRole, removeRole } from "@/domain/admin";
import { markSourceStale, resolveUpdateTask } from "@/domain/updates";
import type { Role } from "@prisma/client";

function errMsg(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOpt = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v.length ? Number(v) : undefined;
};

export async function importAnalyticsAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/analytics";
  try {
    await importAnalyticsSnapshot(actor, {
      contentId: s(fd, "contentId"),
      platform: s(fd, "platform") || "youtube",
      impressions: numOpt(fd, "impressions"),
      views: numOpt(fd, "views"),
      ctr: numOpt(fd, "ctr"),
      firstThirtySecondRetention: numOpt(fd, "firstThirtySecondRetention"),
      averagePercentageViewed: numOpt(fd, "averagePercentageViewed"),
      watchHours: numOpt(fd, "watchHours"),
      subscribersGained: numOpt(fd, "subscribersGained"),
    });
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function assignRoleAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/admin/roles";
  try {
    await assignRole(actor, s(fd, "userId"), s(fd, "role") as Role);
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function removeRoleAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/admin/roles";
  try {
    await removeRole(actor, s(fd, "userId"), s(fd, "role") as Role);
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function markSourceStaleAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/updates";
  try {
    await markSourceStale(actor, s(fd, "sourceId"), s(fd, "reason") || "Marked stale");
    revalidatePath(to);
    revalidatePath("/studio/sources");
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}

export async function resolveUpdateTaskAction(fd: FormData) {
  const actor = await requireActor();
  let to = "/studio/updates";
  try {
    await resolveUpdateTask(actor, s(fd, "taskId"));
    revalidatePath(to);
  } catch (e) {
    to = `${to}?error=${encodeURIComponent(errMsg(e))}`;
  }
  redirect(to);
}
