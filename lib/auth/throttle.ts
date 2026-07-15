import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// Fixed-window sign-in throttling (per email and per IP), DB-backed so it
// survives restarts and works across instances. Applies before password
// verification and before identity is known, so nonexistent accounts are
// throttled identically to real ones (no account-existence oracle).
//
// Policy: an email key allows MAX_EMAIL_FAILURES failures per window; an IP
// key allows the higher MAX_IP_FAILURES (several people can share an IP).
// Hitting the limit locks that key for LOCK_MS. A successful sign-in clears
// the email key's counter.

export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const MAX_EMAIL_FAILURES = 5;
export const MAX_IP_FAILURES = 20;

export function emailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}
export function ipKey(ip: string): string {
  return `ip:${ip}`;
}

function limitFor(key: string): number {
  return key.startsWith("ip:") ? MAX_IP_FAILURES : MAX_EMAIL_FAILURES;
}

// True if any of the given keys is currently locked out.
export async function isSignInLocked(keys: string[], now = new Date()): Promise<boolean> {
  const rows = await prisma.signInThrottle.findMany({ where: { key: { in: keys } } });
  return rows.some((r) => r.lockedUntil !== null && r.lockedUntil > now);
}

// Records one failed attempt against every key. Returns true if this failure
// caused any key to transition into the locked state.
export async function recordSignInFailure(keys: string[], now = new Date()): Promise<boolean> {
  let lockedNow = false;
  for (const key of keys) {
    const existing = await prisma.signInThrottle.findUnique({ where: { key } });
    const windowExpired =
      !existing || now.getTime() - existing.windowStartedAt.getTime() > THROTTLE_WINDOW_MS;
    const failedCount = windowExpired ? 1 : existing.failedCount + 1;
    const shouldLock = failedCount >= limitFor(key);
    const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_MS) : null;

    await prisma.signInThrottle.upsert({
      where: { key },
      create: { key, failedCount, windowStartedAt: now, lockedUntil },
      update: {
        failedCount,
        windowStartedAt: windowExpired ? now : existing.windowStartedAt,
        // Never shorten an existing lock.
        ...(lockedUntil ? { lockedUntil } : {}),
      },
    });
    if (shouldLock && !(existing?.lockedUntil && existing.lockedUntil > now)) {
      lockedNow = true;
    }
  }
  return lockedNow;
}

// Clears the given keys after a successful sign-in (email key only — the IP
// window keeps counting so a rotating-password attack from one IP still hits
// the IP ceiling).
export async function clearSignInThrottle(keys: string[]): Promise<void> {
  await prisma.signInThrottle.deleteMany({ where: { key: { in: keys } } });
}

// Audits a lockout for a known user (unknown emails have no workspace to
// attach the event to; they are still throttled, just not audited).
export async function auditLockout(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  await writeAudit({
    workspaceId: user.workspaceId,
    actorId: null, // SYSTEM: the lockout is not an action by the (possibly attacked) user
    action: "auth.lockout",
    entityType: "User",
    entityId: user.id,
    metadata: { email, windowMs: THROTTLE_WINDOW_MS, lockMs: LOCK_MS },
  });
}
