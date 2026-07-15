import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  emailKey,
  ipKey,
  isSignInLocked,
  recordSignInFailure,
  clearSignInThrottle,
  MAX_EMAIL_FAILURES,
  MAX_IP_FAILURES,
  THROTTLE_WINDOW_MS,
  LOCK_MS,
} from "@/lib/auth/throttle";

// Unique keys per run so this file never collides with other files sharing
// the test database.
const run = Date.now().toString(36);
const EMAIL = `throttle-${run}@leonida.test`;
const IP = `203.0.113.${Math.floor(Math.random() * 200)}`; // TEST-NET-3, never real

beforeEach(async () => {
  await prisma.signInThrottle.deleteMany({
    where: { key: { in: [emailKey(EMAIL), ipKey(IP)] } },
  });
});

afterAll(async () => {
  await prisma.signInThrottle.deleteMany({ where: { key: { contains: run } } });
  await prisma.$disconnect();
});

describe("sign-in throttling (fixed window, DB-backed)", () => {
  it("locks the email key after MAX_EMAIL_FAILURES failures in a window", async () => {
    const keys = [emailKey(EMAIL)];
    for (let i = 0; i < MAX_EMAIL_FAILURES - 1; i++) {
      const locked = await recordSignInFailure(keys);
      expect(locked).toBe(false);
      expect(await isSignInLocked(keys)).toBe(false);
    }
    // The limit-hitting failure reports the transition exactly once.
    expect(await recordSignInFailure(keys)).toBe(true);
    expect(await isSignInLocked(keys)).toBe(true);
    expect(await recordSignInFailure(keys)).toBe(false); // already locked, no re-transition
  });

  it("clears the counter on success so failures do not accumulate forever", async () => {
    const keys = [emailKey(EMAIL)];
    for (let i = 0; i < MAX_EMAIL_FAILURES - 1; i++) await recordSignInFailure(keys);
    await clearSignInThrottle(keys);
    // A fresh failure after the clear starts a new count of 1, not MAX.
    expect(await recordSignInFailure(keys)).toBe(false);
    expect(await isSignInLocked(keys)).toBe(false);
  });

  it("lock expires after LOCK_MS", async () => {
    const keys = [emailKey(EMAIL)];
    for (let i = 0; i < MAX_EMAIL_FAILURES; i++) await recordSignInFailure(keys);
    expect(await isSignInLocked(keys)).toBe(true);
    // Evaluate "now" as a time after the lock expiry — no real waiting.
    const afterExpiry = new Date(Date.now() + LOCK_MS + 1000);
    expect(await isSignInLocked(keys, afterExpiry)).toBe(false);
  });

  it("failure window resets: old failures do not count toward a new window", async () => {
    const keys = [emailKey(EMAIL)];
    const past = new Date(Date.now() - THROTTLE_WINDOW_MS - 60_000);
    for (let i = 0; i < MAX_EMAIL_FAILURES - 1; i++) await recordSignInFailure(keys, past);
    // Next failure arrives after the window: count restarts at 1, no lock.
    expect(await recordSignInFailure(keys)).toBe(false);
    const row = await prisma.signInThrottle.findUnique({ where: { key: emailKey(EMAIL) } });
    expect(row?.failedCount).toBe(1);
  });

  it("IP key has its own higher ceiling and locks independently of email keys", async () => {
    const ip = [ipKey(IP)];
    for (let i = 0; i < MAX_IP_FAILURES - 1; i++) {
      expect(await recordSignInFailure(ip)).toBe(false);
    }
    expect(await recordSignInFailure(ip)).toBe(true);
    expect(await isSignInLocked(ip)).toBe(true);
    // An unrelated email key is unaffected.
    expect(await isSignInLocked([emailKey(EMAIL)])).toBe(false);
  });

  it("isSignInLocked treats any locked key in the set as a lockout", async () => {
    for (let i = 0; i < MAX_EMAIL_FAILURES; i++) await recordSignInFailure([emailKey(EMAIL)]);
    expect(await isSignInLocked([emailKey(EMAIL), ipKey(IP)])).toBe(true);
  });
});
