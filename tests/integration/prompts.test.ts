import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import {
  createPromptTemplateVersion,
  setPromptTemplateActive,
  listPromptTemplates,
  activePromptTemplate,
} from "@/domain/prompts";
import { generateContentPacket } from "@/domain/aiContent";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let ws: Awaited<ReturnType<typeof makeWorkspace>>;
let owner: A, editor: A;

beforeAll(async () => {
  ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function generateFor(actor: A) {
  const content = await createContent(actor, {
    type: "LONG_VIDEO",
    pillar: "BRIEFING",
    workingTitle: "Prompt template generation test",
  });
  return generateContentPacket(actor, { contentId: content.id, sourceIds: [], claimIds: [] });
}

describe("prompt-template administration", () => {
  it("owner creates append-only versions; version numbers increment", async () => {
    const v1 = await createPromptTemplateVersion(owner, {
      key: "content_packet",
      systemText: "Prefer short declarative sentences.",
    });
    expect(v1.version).toBe(1);
    expect(v1.active).toBe(true);

    const v2 = await createPromptTemplateVersion(owner, {
      key: "content_packet",
      systemText: "Open with the direct answer, then the evidence.",
    });
    expect(v2.version).toBe(2);

    const all = await listPromptTemplates(owner);
    expect(all.map((t) => t.version)).toEqual([2, 1]); // newest first
    // Audit recorded for each version.
    const audits = await prisma.auditEvent.count({
      where: { workspaceId: owner.workspaceId, action: "prompt.version_created" },
    });
    expect(audits).toBe(2);
  });

  it("non-owners cannot manage templates", async () => {
    await expect(
      createPromptTemplateVersion(editor, {
        key: "content_packet",
        systemText: "Editor should not be able to do this.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listPromptTemplates(editor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("generation records the highest ACTIVE version; deactivation rolls back", async () => {
    // v2 is active and highest → generation records 2.
    const genV2 = await generateFor(owner);
    expect(genV2.generation.promptTemplateVersion).toBe(2);
    expect(genV2.validation.status).toBe("VALID"); // mock output unaffected by template

    // Deactivate v2 → falls back to v1.
    const v2 = await prisma.promptTemplate.findFirst({
      where: { workspaceId: owner.workspaceId, key: "content_packet", version: 2 },
    });
    await setPromptTemplateActive(owner, v2!.id, false);
    const genV1 = await generateFor(owner);
    expect(genV1.generation.promptTemplateVersion).toBe(1);

    // Deactivate v1 too → built-in prompt, version 0.
    const v1 = await prisma.promptTemplate.findFirst({
      where: { workspaceId: owner.workspaceId, key: "content_packet", version: 1 },
    });
    await setPromptTemplateActive(owner, v1!.id, false);
    const genBuiltIn = await generateFor(owner);
    expect(genBuiltIn.generation.promptTemplateVersion).toBe(0);

    // Reactivate v2 for later assertions; double-activation is refused.
    await setPromptTemplateActive(owner, v2!.id, true);
    await expect(setPromptTemplateActive(owner, v2!.id, true)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("templates are workspace-isolated", async () => {
    const other = await makeWorkspace();
    const otherOwner = await other.actor([Role.OWNER], "other-owner");

    // The other workspace sees no templates and generates with the built-in prompt.
    expect(await listPromptTemplates(otherOwner)).toEqual([]);
    expect(await activePromptTemplate(otherOwner.workspaceId, "content_packet")).toBeNull();
    const gen = await generateFor(otherOwner);
    expect(gen.generation.promptTemplateVersion).toBe(0);

    // And cannot toggle a template owned by the first workspace.
    const foreign = await prisma.promptTemplate.findFirst({
      where: { workspaceId: owner.workspaceId },
    });
    await expect(setPromptTemplateActive(otherOwner, foreign!.id, false)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
