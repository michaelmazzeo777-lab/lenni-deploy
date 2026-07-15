"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import {
  emailKey,
  ipKey,
  isSignInLocked,
  recordSignInFailure,
  clearSignInThrottle,
  auditLockout,
} from "@/lib/auth/throttle";

const LOCKOUT_MESSAGE = "Too many failed sign-in attempts. Try again in about 15 minutes.";

// Best-effort client IP for throttling. Behind a proxy the first
// x-forwarded-for hop is the client; locally there may be no header at all.
// A spoofable header only weakens the per-IP ceiling — the per-email
// ceiling does not depend on it.
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const keys = [emailKey(email), ipKey(await clientIp())];

  // Throttle check runs before any password work, for real and unknown
  // accounts alike, so lockout behavior does not reveal account existence.
  if (await isSignInLocked(keys)) {
    redirect("/signin?error=" + encodeURIComponent(LOCKOUT_MESSAGE));
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !verifyPassword(password, user.passwordHash)) {
    const lockedNow = await recordSignInFailure(keys);
    if (lockedNow) await auditLockout(email);
    redirect(
      "/signin?error=" +
        encodeURIComponent(lockedNow ? LOCKOUT_MESSAGE : "Invalid email or password"),
    );
  }

  await clearSignInThrottle([emailKey(email)]);
  const token = await createSession(user.id);
  await setSessionCookie(token);
  redirect("/studio");
}

export async function signOutAction() {
  await clearSessionCookie();
  redirect("/signin");
}
