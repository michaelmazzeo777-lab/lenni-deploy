import { Role, ApprovalScope } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { forbidden } from "@/lib/errors";

// Central capability model. Server-side authorization is mandatory; the UI only
// mirrors these decisions. See docs/01_PRODUCT_REQUIREMENTS.md Epic 1 and
// docs/11_ACCEPTANCE_TESTS.md section B.

export type Capability =
  | "content.create"
  | "content.edit"
  | "content.transition"
  | "content.transition.override"
  | "source.create"
  | "source.edit"
  | "claim.create"
  | "claim.review"
  | "script.write"
  | "asset.create"
  | "rights.review"
  | "packaging.create"
  | "packaging.approve"
  | "approval.grant"
  | "publication.publish"
  | "correction.create"
  | "analytics.import"
  | "role.manage"
  | "ai.generate"
  | "ai.review"
  | "contributor.manage"
  | "assignment.submit"
  | "capture.submit"
  | "capture.review"
  | "visual.brief"
  | "visual.import"
  | "visual.review"
  | "handoff.export"
  | "storage.upload"
  | "storage.scan"
  | "prompt.manage"
  | "shorts.publish"
  | "audit.read";

const MATRIX: Record<Capability, Role[]> = {
  "content.create": [Role.OWNER, Role.EDITOR, Role.RESEARCHER],
  "content.edit": [Role.OWNER, Role.EDITOR, Role.WRITER, Role.PRODUCER],
  "content.transition": [Role.OWNER, Role.EDITOR, Role.PRODUCER],
  "content.transition.override": [Role.OWNER],
  "source.create": [Role.OWNER, Role.EDITOR, Role.RESEARCHER],
  "source.edit": [Role.OWNER, Role.EDITOR, Role.RESEARCHER],
  "claim.create": [Role.OWNER, Role.EDITOR, Role.RESEARCHER],
  "claim.review": [Role.OWNER, Role.EDITOR],
  "script.write": [Role.OWNER, Role.EDITOR, Role.WRITER],
  "asset.create": [Role.OWNER, Role.EDITOR, Role.PRODUCER],
  "rights.review": [Role.OWNER, Role.RIGHTS_REVIEWER],
  "packaging.create": [Role.OWNER, Role.EDITOR, Role.PRODUCER],
  "packaging.approve": [Role.OWNER, Role.EDITOR],
  "approval.grant": [Role.OWNER, Role.EDITOR],
  "publication.publish": [Role.OWNER],
  "correction.create": [Role.OWNER, Role.EDITOR],
  "analytics.import": [Role.OWNER, Role.EDITOR, Role.ANALYST],
  "role.manage": [Role.OWNER],
  "ai.generate": [Role.OWNER, Role.EDITOR, Role.RESEARCHER, Role.WRITER],
  "ai.review": [Role.OWNER, Role.EDITOR],
  "contributor.manage": [Role.OWNER, Role.EDITOR],
  // Contributors act only on their OWN assignments; ownership is enforced in the
  // domain service (assertAssignmentAccess), not by capability alone.
  "assignment.submit": [
    Role.OWNER,
    Role.EDITOR,
    Role.PRODUCER,
    Role.CONTRIBUTOR,
    Role.NARRATOR,
    Role.VIDEO_EDITOR,
    Role.DESIGNER,
    Role.WRITER,
    Role.RESEARCHER,
  ],
  "capture.submit": [Role.OWNER, Role.PRODUCER, Role.CONTRIBUTOR],
  "capture.review": [Role.OWNER, Role.EDITOR],
  "visual.brief": [Role.OWNER, Role.EDITOR, Role.PRODUCER, Role.DESIGNER],
  "visual.import": [Role.OWNER, Role.EDITOR, Role.PRODUCER, Role.DESIGNER],
  "visual.review": [Role.OWNER, Role.RIGHTS_REVIEWER],
  "handoff.export": [Role.OWNER, Role.EDITOR, Role.PRODUCER],
  "storage.upload": [Role.OWNER, Role.EDITOR, Role.PRODUCER, Role.DESIGNER],
  "storage.scan": [Role.OWNER, Role.RIGHTS_REVIEWER],
  // Prompt templates steer AI output; changing them is an Owner-only editorial control.
  "prompt.manage": [Role.OWNER],
  // Publishing a Short to YouTube is an external action; Owner-only, mirroring
  // publication.publish. (Generation/review reuse ai.generate / capture.review.)
  "shorts.publish": [Role.OWNER],
  "audit.read": [
    Role.OWNER,
    Role.EDITOR,
    Role.RESEARCHER,
    Role.WRITER,
    Role.PRODUCER,
    Role.CONTRIBUTOR,
    Role.NARRATOR,
    Role.VIDEO_EDITOR,
    Role.DESIGNER,
    Role.RIGHTS_REVIEWER,
    Role.ANALYST,
    Role.READ_ONLY,
  ],
};

// Which roles may grant which approval scopes. Final editorial + publication
// scopes are restricted to Owner. Rights reviewers can grant only the rights scope.
const SCOPE_GRANTERS: Record<ApprovalScope, Role[]> = {
  EDITORIAL_FACTS: [Role.OWNER, Role.EDITOR],
  SCRIPT: [Role.OWNER, Role.EDITOR],
  RIGHTS: [Role.OWNER, Role.RIGHTS_REVIEWER],
  PACKAGING: [Role.OWNER, Role.EDITOR],
  PUBLIC_WEBSITE: [Role.OWNER],
  YOUTUBE: [Role.OWNER],
  SPONSOR: [Role.OWNER],
  AFFILIATE: [Role.OWNER],
  NEWSLETTER: [Role.OWNER],
  MERCHANDISE: [Role.OWNER],
};

export function can(actor: Pick<Actor, "roles">, capability: Capability): boolean {
  const allowed = MATRIX[capability];
  return actor.roles.some((r) => allowed.includes(r));
}

export function require_(actor: Pick<Actor, "roles">, capability: Capability): void {
  if (!can(actor, capability)) {
    throw forbidden(`Missing capability: ${capability}`);
  }
}

export function canGrantScope(actor: Pick<Actor, "roles">, scope: ApprovalScope): boolean {
  const allowed = SCOPE_GRANTERS[scope];
  return actor.roles.some((r) => allowed.includes(r));
}

export function requireScope(actor: Pick<Actor, "roles">, scope: ApprovalScope): void {
  if (!canGrantScope(actor, scope)) {
    throw forbidden(`Not permitted to grant approval scope: ${scope}`);
  }
}
