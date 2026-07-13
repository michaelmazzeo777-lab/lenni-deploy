import { describe, it, expect } from "vitest";
import { contentRevisionHash } from "@/lib/audit";
import { WORKFLOW_ORDER } from "@/domain/workflow";

const base = {
  workingTitle: "T",
  publicTitle: null,
  spoilerLevel: "NONE",
  scriptBody: "hello",
  claimIds: ["a", "b"],
  assetIds: ["x"],
  thumbnailIds: [],
};

describe("contentRevisionHash", () => {
  it("is stable regardless of claim/asset ordering", () => {
    const h1 = contentRevisionHash(base);
    const h2 = contentRevisionHash({ ...base, claimIds: ["b", "a"] });
    expect(h1).toEqual(h2);
  });

  it("changes when material fields change (invalidates approvals)", () => {
    const h1 = contentRevisionHash(base);
    expect(contentRevisionHash({ ...base, scriptBody: "changed" })).not.toEqual(h1);
    expect(contentRevisionHash({ ...base, spoilerLevel: "ENDING" })).not.toEqual(h1);
    expect(contentRevisionHash({ ...base, claimIds: ["a"] })).not.toEqual(h1);
  });
});

describe("workflow order", () => {
  it("follows the documented state sequence", () => {
    expect(WORKFLOW_ORDER[0]).toBe("IDEA");
    expect(WORKFLOW_ORDER[WORKFLOW_ORDER.length - 1]).toBe("ARCHIVED");
    expect(WORKFLOW_ORDER).toContain("EVIDENCE_READY");
    expect(WORKFLOW_ORDER).toContain("READY");
    expect(WORKFLOW_ORDER.indexOf("APPROVAL")).toBeLessThan(WORKFLOW_ORDER.indexOf("READY"));
  });
});
