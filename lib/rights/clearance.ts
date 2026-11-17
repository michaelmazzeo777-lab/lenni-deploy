// External clearance for a finished clip: three independent layers, none of
// which substitutes for another.
//
//   creator     the rights holder licensed this footage for this use
//   platform    the destination allows it and an account is verified
//   publisher   Rockstar/Take-Two, music, editorial and Mike's release review
//
// Internal draft export (review bundle) never depends on this. External
// delivery is available only when every layer passes. The Studio has no
// record type for the publisher layer, so it cannot pass here: that review
// happens outside the Studio and publication stays blocked.
import type { AgreementStatus, MediaRightsStatus } from "@prisma/client";
import { effectiveStatus } from "@/lib/rights/agreements";

export interface ClearanceInput {
  now: Date;
  destination: string | null; // e.g. "youtube"
  media: {
    rightsStatus: MediaRightsStatus;
    rightsReviewDecision: string | null;
    thirdPartyNotes: string | null;
  } | null;
  agreement: {
    status: AgreementStatus;
    expiresAt: Date | null;
    approvedDestinations: string[];
    editingAllowed: boolean;
    derivativesAllowed: boolean;
  } | null;
  clipOwnerApproved: boolean;
  platformAccountVerified: boolean;
}

export interface Layer {
  ok: boolean;
  reasons: string[];
}

export interface Clearance {
  cleared: boolean;
  creator: Layer;
  platform: Layer;
  publisher: Layer;
}

export function externalClearance(i: ClearanceInput): Clearance {
  const creator: string[] = [];
  if (!i.media) creator.push("No source recording is attached");
  else if (i.media.rightsStatus === "INTERNAL_FIXTURE")
    creator.push("Internal test fixture: never deliverable");
  else if (i.media.rightsStatus === "UNCLEARED" && !i.agreement)
    creator.push("Footage rights are uncleared and no creator agreement is linked");
  if (i.agreement) {
    const status = effectiveStatus(i.agreement, i.now);
    if (status === "EXPIRED") creator.push("The creator agreement has expired");
    else if (status === "REVOKED") creator.push("The creator agreement was revoked");
    else if (status !== "ACTIVE") creator.push(`The creator agreement is not active (${status})`);
    if (!i.agreement.editingAllowed || !i.agreement.derivativesAllowed)
      creator.push("The agreement does not allow editing into derivative clips");
    if (i.destination && !i.agreement.approvedDestinations.includes(i.destination))
      creator.push(`The agreement does not approve ${i.destination}`);
  }
  if (i.media && i.media.rightsReviewDecision !== "APPROVED")
    creator.push("No human rights review has approved this recording");

  const platform: string[] = [];
  if (!i.destination) platform.push("No destination platform chosen");
  if (!i.platformAccountVerified)
    platform.push("No platform account is connected and verified (publishing is manual)");

  const publisher: string[] = [];
  if (!i.clipOwnerApproved) publisher.push("Mike has not approved this exact file");
  publisher.push(
    "Rockstar/Take-Two footage rights, music and editorial release are reviewed outside the Studio; publication stays blocked",
  );

  const layer = (r: string[]): Layer => ({ ok: r.length === 0, reasons: r });
  const out = { creator: layer(creator), platform: layer(platform), publisher: layer(publisher) };
  return { cleared: out.creator.ok && out.platform.ok && out.publisher.ok, ...out };
}
