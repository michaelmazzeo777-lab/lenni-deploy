// Creator agreement lifecycle: which status may follow which, and what
// evidence each step needs. Pure functions; domain/rights.ts persists.
//
// A status here is a record of what Mike did or verified outside the Studio.
// The Studio never contacts a creator, sends a document or collects a
// signature, and no status means more than its evidence shows.
import type { AgreementStatus } from "@prisma/client";

export const NEXT: Record<AgreementStatus, AgreementStatus[]> = {
  AGREEMENT_DRAFT: ["LEGAL_REVIEW", "REJECTED"],
  LEGAL_REVIEW: ["APPROVED_TO_CONTACT", "AGREEMENT_DRAFT", "REJECTED"],
  APPROVED_TO_CONTACT: ["SENT", "REJECTED"],
  SENT: ["NEGOTIATING", "EXECUTED_VERIFIED", "REJECTED"],
  NEGOTIATING: ["LEGAL_REVIEW", "EXECUTED_VERIFIED", "REJECTED"],
  EXECUTED_VERIFIED: ["ACTIVE", "REVOKED"],
  ACTIVE: ["EXPIRED", "REVOKED"],
  EXPIRED: [],
  REVOKED: [],
  REJECTED: [],
};

/** Steps only the Owner may record. */
export const OWNER_ONLY: AgreementStatus[] = [
  "APPROVED_TO_CONTACT",
  "EXECUTED_VERIFIED",
  "ACTIVE",
  "REVOKED",
];

/** Terms can change only while nothing has been sent or signed on them. */
export const TERMS_EDITABLE: AgreementStatus[] = ["AGREEMENT_DRAFT", "NEGOTIATING"];

export const STATUS_LABEL: Record<AgreementStatus, string> = {
  AGREEMENT_DRAFT: "Draft (not sent)",
  LEGAL_REVIEW: "In legal review",
  APPROVED_TO_CONTACT: "Approved to contact (not sent)",
  SENT: "Sent by Mike (recorded)",
  NEGOTIATING: "Negotiating",
  EXECUTED_VERIFIED: "Executed - signature verified",
  ACTIVE: "Active licence",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  REJECTED: "Rejected / closed",
};

export interface AgreementFacts {
  status: AgreementStatus;
  rightsOwner: string | null;
  ownershipEvidence: string | null;
  footageScope: string | null;
  effectiveAt: Date | null;
  expiresAt: Date | null;
  legalReviewer: string | null;
  legalReviewNote: string | null;
  legalReviewedAt: Date | null;
  signatureEvidence: string | null;
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;

/** An ACTIVE agreement past its expiry is expired, whether or not anyone recorded it yet. */
export function effectiveStatus(a: Pick<AgreementFacts, "status" | "expiresAt">, now: Date) {
  if (a.status === "ACTIVE" && a.expiresAt && a.expiresAt <= now) return "EXPIRED" as const;
  return a.status;
}

/**
 * Everything wrong with moving `a` to `to`. Empty means the step is allowed.
 * `a` must already include any fields supplied with this step.
 */
export function transitionProblems(
  a: AgreementFacts,
  to: AgreementStatus,
  evidence: string,
  opts: { isOwner: boolean; now: Date },
): string[] {
  const out: string[] = [];
  const from = effectiveStatus(a, opts.now);
  if (!NEXT[from].includes(to)) {
    return [`An agreement that is ${STATUS_LABEL[from]} cannot become ${STATUS_LABEL[to]}`];
  }
  if (evidence.trim().length < 10)
    out.push("Record the evidence for this step (at least a sentence)");
  if (OWNER_ONLY.includes(to) && !opts.isOwner) out.push("Only the Owner can record this step");
  switch (to) {
    case "APPROVED_TO_CONTACT":
      if (!filled(a.legalReviewer)) out.push("Name the legal reviewer");
      if (!filled(a.legalReviewNote)) out.push("Record the legal review outcome");
      break;
    case "EXECUTED_VERIFIED":
      if (!filled(a.signatureEvidence))
        out.push("Record where the signed agreement is and how the signature was verified");
      if (!filled(a.rightsOwner)) out.push("Name the rights owner");
      if (!filled(a.ownershipEvidence)) out.push("Record the evidence of ownership");
      if (!filled(a.footageScope)) out.push("Describe exactly which footage is licensed");
      if (!a.effectiveAt) out.push("Set the effective date");
      if (!a.legalReviewedAt) out.push("The agreement has not been through legal review");
      break;
    case "ACTIVE":
      if (!a.effectiveAt || a.effectiveAt > opts.now)
        out.push("The agreement is not in effect yet");
      if (a.expiresAt && a.expiresAt <= opts.now) out.push("The agreement has already expired");
      break;
    case "EXPIRED":
      if (!a.expiresAt || a.expiresAt > opts.now)
        out.push("The agreement has not reached its expiry date");
      break;
  }
  return out;
}
