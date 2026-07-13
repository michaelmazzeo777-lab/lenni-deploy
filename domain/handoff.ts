import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";

// Builds the production handoff packet from CURRENT approved records. It is a
// download only — the app never sends it anywhere.

export interface HandoffPacket {
  generatedAt: string;
  content: { id: string; workingTitle: string; status: string; spoilerLevel: string };
  brief: { objective: string; prohibitedAssertions: string[] } | null;
  script: { version: number; body: string } | null;
  shotList: { order: number; title: string; description: string | null; notes: string | null }[];
  approvedCaptures: {
    id: string;
    platform: string;
    gameVersion: string;
    fileReference: string | null;
  }[];
  approvedVisuals: {
    id: string;
    kind: string;
    title: string;
    provider: string;
    model: string;
    location: string | null;
    disclosureDecision: string | null;
  }[];
  assignments: { kind: string; contributor: string; status: string; dueAt: string | null }[];
  thumbnailBriefs: { name: string; brief: string }[];
  titleVariants: string[];
  musicRestrictions: string;
  sourceAndRightsNotes: string[];
  exportChecklist: string[];
}

export async function buildHandoffPacket(actor: Actor, contentId: string): Promise<HandoffPacket> {
  require_(actor, "handoff.export");
  const content = await prisma.contentItem.findFirst({
    where: { id: contentId, workspaceId: actor.workspaceId },
    include: {
      briefs: { orderBy: { version: "desc" }, take: 1 },
      scripts: { orderBy: { version: "desc" }, take: 1 },
      shots: { orderBy: { order: "asc" } },
      captureSessions: { where: { status: "APPROVED" } },
      visualBriefs: { include: { assets: { where: { status: "APPROVED" } } } },
      assignments: { include: { contributor: true } },
      thumbnails: true,
      titleVariants: true,
      claims: { include: { claim: { include: { sources: { include: { source: true } } } } } },
    },
  });
  if (!content) throw notFound("Content item not found");

  const script = content.scripts[0] ?? null;
  const brief = content.briefs[0] ?? null;
  const approvedVisuals = content.visualBriefs.flatMap((vb) =>
    vb.assets.map((a) => ({
      id: a.id,
      kind: vb.kind,
      title: vb.title,
      provider: a.provider,
      model: a.model,
      location: a.location,
      disclosureDecision: a.disclosureDecision,
    })),
  );
  const sources = new Set<string>();
  for (const link of content.claims) {
    for (const cs of link.claim.sources) {
      sources.add(`${cs.source.publisher}: ${cs.source.title}`);
    }
  }

  const packet: HandoffPacket = {
    generatedAt: new Date().toISOString(),
    content: {
      id: content.id,
      workingTitle: content.workingTitle,
      status: content.status,
      spoilerLevel: content.spoilerLevel,
    },
    brief: brief
      ? { objective: brief.objective, prohibitedAssertions: brief.prohibitedAssertions }
      : null,
    script: script ? { version: script.version, body: script.body } : null,
    shotList: content.shots.map((s) => ({
      order: s.order,
      title: s.title,
      description: s.description,
      notes: s.captureNotes,
    })),
    approvedCaptures: content.captureSessions.map((c) => ({
      id: c.id,
      platform: c.platform,
      gameVersion: c.gameVersion,
      fileReference: c.fileReference,
    })),
    approvedVisuals,
    assignments: content.assignments.map((a) => ({
      kind: a.kind,
      contributor: a.contributor.displayName,
      status: a.status,
      dueAt: a.dueAt?.toISOString() ?? null,
    })),
    thumbnailBriefs: content.thumbnails.map((t) => ({ name: t.name, brief: t.brief })),
    titleVariants: content.titleVariants.map((t) => t.text),
    musicRestrictions:
      "No licensed or in-game music. Only original or verifiably licensed-for-use tracks; log every track in the asset ledger.",
    sourceAndRightsNotes: [
      ...sources,
      "All claims keep their classification labels; leaked material is prohibited.",
      "AI visuals are supporting graphics only and must carry their disclosure decision.",
    ],
    exportChecklist: [
      "Confirm every capture in this packet is APPROVED and matches the shot list",
      "Confirm every visual asset carries provider, model, and disclosure decision",
      "Confirm contributor rights releases are RECEIVED",
      "Confirm no leaked, fake, or deceptive material is referenced",
      "Confirm title/thumbnail deception checks are complete",
      "Final editorial + rights + packaging approvals before READY",
    ],
  };

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "handoff.exported",
    entityType: "ContentItem",
    entityId: contentId,
    metadata: { shots: packet.shotList.length, visuals: approvedVisuals.length },
  });

  return packet;
}

export function handoffToMarkdown(p: HandoffPacket): string {
  const lines = [
    `# Production handoff — ${p.content.workingTitle}`,
    ``,
    `Generated ${p.generatedAt} · Status ${p.content.status} · Spoiler ${p.content.spoilerLevel}`,
    ``,
    `## Brief`,
    p.brief ? p.brief.objective : "_No brief recorded._",
    ...(p.brief?.prohibitedAssertions.length
      ? ["", "**Prohibited assertions:**", ...p.brief.prohibitedAssertions.map((a) => `- ${a}`)]
      : []),
    ``,
    `## Script (v${p.script?.version ?? "—"})`,
    p.script?.body ?? "_No script version._",
    ``,
    `## Shot list`,
    ...(p.shotList.length
      ? p.shotList.map(
          (s) =>
            `${s.order}. **${s.title}** — ${s.description ?? ""} ${s.notes ? `(_${s.notes}_)` : ""}`,
        )
      : ["_No shots._"]),
    ``,
    `## Approved gameplay captures`,
    ...(p.approvedCaptures.length
      ? p.approvedCaptures.map(
          (c) => `- ${c.platform} · ${c.gameVersion} · ${c.fileReference ?? "no file ref"}`,
        )
      : ["_None approved._"]),
    ``,
    `## Approved generated visuals`,
    ...(p.approvedVisuals.length
      ? p.approvedVisuals.map(
          (v) =>
            `- [${v.kind}] ${v.title} — ${v.provider}/${v.model} · disclosure: ${v.disclosureDecision}`,
        )
      : ["_None approved._"]),
    ``,
    `## Assignments`,
    ...(p.assignments.length
      ? p.assignments.map(
          (a) =>
            `- ${a.kind}: ${a.contributor} (${a.status}${a.dueAt ? `, due ${a.dueAt.slice(0, 10)}` : ""})`,
        )
      : ["_None._"]),
    ``,
    `## Titles`,
    ...(p.titleVariants.length ? p.titleVariants.map((t) => `- ${t}`) : ["_None._"]),
    ``,
    `## Thumbnail briefs`,
    ...(p.thumbnailBriefs.length
      ? p.thumbnailBriefs.map((t) => `- **${t.name}**: ${t.brief}`)
      : ["_None._"]),
    ``,
    `## Music restrictions`,
    p.musicRestrictions,
    ``,
    `## Source & rights notes`,
    ...p.sourceAndRightsNotes.map((n) => `- ${n}`),
    ``,
    `## Export checklist`,
    ...p.exportChecklist.map((c) => `- [ ] ${c}`),
  ];
  return lines.join("\n");
}
