import { describe, it, expect } from "vitest";
import { Role, ApprovalScope } from "@prisma/client";
import { can, canGrantScope } from "@/lib/permissions";

const roles = (r: Role[]) => ({ roles: r });

describe("RBAC capability matrix", () => {
  it("Read Only cannot mutate but can read audit", () => {
    expect(can(roles([Role.READ_ONLY]), "content.create")).toBe(false);
    expect(can(roles([Role.READ_ONLY]), "source.create")).toBe(false);
    expect(can(roles([Role.READ_ONLY]), "publication.publish")).toBe(false);
    expect(can(roles([Role.READ_ONLY]), "audit.read")).toBe(true);
  });

  it("Researcher can create sources and claims but not approve publication", () => {
    expect(can(roles([Role.RESEARCHER]), "source.create")).toBe(true);
    expect(can(roles([Role.RESEARCHER]), "claim.create")).toBe(true);
    expect(can(roles([Role.RESEARCHER]), "claim.review")).toBe(false);
    expect(can(roles([Role.RESEARCHER]), "publication.publish")).toBe(false);
    expect(canGrantScope(roles([Role.RESEARCHER]), ApprovalScope.PUBLIC_WEBSITE)).toBe(false);
  });

  it("Rights Reviewer can review assets but not grant final editorial approval", () => {
    expect(can(roles([Role.RIGHTS_REVIEWER]), "rights.review")).toBe(true);
    expect(canGrantScope(roles([Role.RIGHTS_REVIEWER]), ApprovalScope.RIGHTS)).toBe(true);
    expect(canGrantScope(roles([Role.RIGHTS_REVIEWER]), ApprovalScope.EDITORIAL_FACTS)).toBe(false);
    expect(canGrantScope(roles([Role.RIGHTS_REVIEWER]), ApprovalScope.PUBLIC_WEBSITE)).toBe(false);
  });

  it("Only Owner can publish and grant the public-website scope", () => {
    expect(can(roles([Role.OWNER]), "publication.publish")).toBe(true);
    expect(can(roles([Role.EDITOR]), "publication.publish")).toBe(false);
    expect(canGrantScope(roles([Role.OWNER]), ApprovalScope.PUBLIC_WEBSITE)).toBe(true);
    expect(canGrantScope(roles([Role.EDITOR]), ApprovalScope.PUBLIC_WEBSITE)).toBe(false);
  });

  it("multiple roles union their capabilities", () => {
    expect(can(roles([Role.READ_ONLY, Role.RESEARCHER]), "source.create")).toBe(true);
  });
});
