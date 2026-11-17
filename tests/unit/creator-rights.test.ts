import { describe, it, expect } from "vitest";
import {
  effectiveStatus,
  NEXT,
  transitionProblems,
  type AgreementFacts,
} from "@/lib/rights/agreements";
import { externalClearance, type ClearanceInput } from "@/lib/rights/clearance";

const now = new Date("2026-11-17T12:00:00Z");
const day = 86_400_000;
const facts = (over: Partial<AgreementFacts> = {}): AgreementFacts => ({
  status: "AGREEMENT_DRAFT",
  rightsOwner: null,
  ownershipEvidence: null,
  footageScope: null,
  effectiveAt: null,
  expiresAt: null,
  legalReviewer: null,
  legalReviewNote: null,
  legalReviewedAt: null,
  signatureEvidence: null,
  ...over,
});
const ev = "Recorded by Mike with a reference to the file.";
const owner = { isOwner: true, now };

describe("agreement transitions", () => {
  it("allows only the defined next steps", () => {
    expect(transitionProblems(facts(), "LEGAL_REVIEW", ev, owner)).toEqual([]);
    expect(transitionProblems(facts(), "ACTIVE", ev, owner)[0]).toMatch(/cannot become/);
    expect(transitionProblems(facts({ status: "SENT" }), "AGREEMENT_DRAFT", ev, owner)[0]).toMatch(
      /cannot become/,
    );
  });

  it("treats expired, revoked and rejected as final", () => {
    expect(NEXT.EXPIRED).toEqual([]);
    expect(NEXT.REVOKED).toEqual([]);
    expect(NEXT.REJECTED).toEqual([]);
  });

  it("requires written evidence for every step", () => {
    expect(transitionProblems(facts(), "LEGAL_REVIEW", "ok", owner).join()).toMatch(/evidence/);
  });

  it("needs a named legal reviewer and outcome before contact is approved", () => {
    const p = transitionProblems(
      facts({ status: "LEGAL_REVIEW" }),
      "APPROVED_TO_CONTACT",
      ev,
      owner,
    );
    expect(p.join()).toMatch(/legal reviewer/);
    expect(p.join()).toMatch(/legal review outcome/);
  });

  it("lets only the Owner record contact approval, execution, activation and revocation", () => {
    const ready = facts({
      status: "LEGAL_REVIEW",
      legalReviewer: "Counsel",
      legalReviewNote: "Reviewed",
    });
    expect(
      transitionProblems(ready, "APPROVED_TO_CONTACT", ev, { isOwner: false, now }).join(),
    ).toMatch(/Only the Owner/);
  });

  it("never treats a sent draft as executed without signature and ownership evidence", () => {
    const p = transitionProblems(facts({ status: "SENT" }), "EXECUTED_VERIFIED", ev, owner).join();
    for (const need of [
      "signed agreement",
      "rights owner",
      "ownership",
      "which footage",
      "effective date",
      "legal review",
    ])
      expect(p).toMatch(new RegExp(need));
  });

  it("activates only once in effect and not expired", () => {
    const exec = facts({ status: "EXECUTED_VERIFIED", effectiveAt: new Date(now.getTime() + day) });
    expect(transitionProblems(exec, "ACTIVE", ev, owner).join()).toMatch(/not in effect/);
    const ok = facts({ status: "EXECUTED_VERIFIED", effectiveAt: new Date(now.getTime() - day) });
    expect(transitionProblems(ok, "ACTIVE", ev, owner)).toEqual([]);
  });

  it("reads an active agreement past its end date as expired", () => {
    const a = { status: "ACTIVE" as const, expiresAt: new Date(now.getTime() - 1) };
    expect(effectiveStatus(a, now)).toBe("EXPIRED");
    expect(transitionProblems(facts(a), "REVOKED", ev, owner)[0]).toMatch(/cannot become/);
  });
});

const media = {
  rightsStatus: "UNCLEARED" as const,
  rightsReviewDecision: "APPROVED",
  thirdPartyNotes: null,
};
const activeAgreement = {
  status: "ACTIVE" as const,
  expiresAt: new Date(now.getTime() + 30 * day),
  approvedDestinations: ["youtube"],
  editingAllowed: true,
  derivativesAllowed: true,
};
const input = (over: Partial<ClearanceInput> = {}): ClearanceInput => ({
  now,
  destination: "youtube",
  media,
  agreement: activeAgreement,
  clipOwnerApproved: true,
  platformAccountVerified: true,
  ...over,
});

describe("external clearance: three independent layers", () => {
  it("is never cleared today, because the publisher layer is reviewed outside the Studio", () => {
    const c = externalClearance(input());
    expect(c.creator.ok).toBe(true);
    expect(c.platform.ok).toBe(true);
    expect(c.publisher.ok).toBe(false);
    expect(c.cleared).toBe(false);
  });

  it("does not let a creator agreement stand in for a platform account", () => {
    const c = externalClearance(input({ platformAccountVerified: false }));
    expect(c.creator.ok).toBe(true);
    expect(c.platform.reasons.join()).toMatch(/No platform account/);
  });

  it("blocks the creator layer when the agreement expired or was revoked", () => {
    const expired = externalClearance(
      input({ agreement: { ...activeAgreement, expiresAt: new Date(now.getTime() - 1) } }),
    );
    expect(expired.creator.reasons.join()).toMatch(/expired/);
    const revoked = externalClearance(
      input({ agreement: { ...activeAgreement, status: "REVOKED" } }),
    );
    expect(revoked.creator.reasons.join()).toMatch(/revoked/);
  });

  it("blocks a destination the agreement does not name, and edits it does not allow", () => {
    const c = externalClearance(
      input({
        destination: "tiktok",
        agreement: { ...activeAgreement, derivativesAllowed: false },
      }),
    );
    expect(c.creator.reasons.join()).toMatch(/does not approve tiktok/);
    expect(c.creator.reasons.join()).toMatch(/derivative/);
  });

  it("blocks uncleared footage with no agreement, fixtures always, and unreviewed media", () => {
    expect(externalClearance(input({ agreement: null })).creator.reasons.join()).toMatch(
      /uncleared/,
    );
    expect(
      externalClearance(input({ media: { ...media, rightsStatus: "INTERNAL_FIXTURE" } })).creator
        .ok,
    ).toBe(false);
    expect(
      externalClearance(
        input({ media: { ...media, rightsReviewDecision: null } }),
      ).creator.reasons.join(),
    ).toMatch(/human rights review/);
  });

  it("requires Mike's approval of the exact file", () => {
    expect(externalClearance(input({ clipOwnerApproved: false })).publisher.reasons.join()).toMatch(
      /Mike has not approved/,
    );
  });
});
