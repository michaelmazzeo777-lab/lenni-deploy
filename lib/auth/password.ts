import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

// Local-development credential hashing. The auth adapter is replaceable for
// production (see docs/03_TECHNICAL_ARCHITECTURE.md — Authentication).

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, KEYLEN);
  const expectedBuf = Buffer.from(expected, "hex");
  if (expectedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

// Deterministic token hashing for session storage (we never store raw tokens).
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
