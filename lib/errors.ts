// Typed domain errors. UI/route layers map these to safe HTTP-ish responses
// without leaking internal detail.

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_TRANSITION"
  | "PRECONDITION_FAILED"
  | "RIGHTS_BLOCK"
  | "AI_QUARANTINE"
  | "CONFLICT";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export const forbidden = (msg = "Not authorized for this action") =>
  new DomainError("FORBIDDEN", msg);
export const notFound = (msg = "Record not found") => new DomainError("NOT_FOUND", msg);
export const unauthenticated = (msg = "Sign in required") =>
  new DomainError("UNAUTHENTICATED", msg);
export const precondition = (msg: string, details?: unknown) =>
  new DomainError("PRECONDITION_FAILED", msg, details);
export const invalidTransition = (msg: string, details?: unknown) =>
  new DomainError("INVALID_TRANSITION", msg, details);
