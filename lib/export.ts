import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/context";

export type ExportType = "claims" | "sources" | "content" | "audit";
export type ExportFormat = "csv" | "json";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\n");
}

// Builds a workspace-scoped export. Returns flat rows with no secret fields
// (docs/spec/01 Epic 12: "no secrets in export").
async function collect(actor: Actor, type: ExportType): Promise<Record<string, unknown>[]> {
  const ws = actor.workspaceId;
  switch (type) {
    case "claims": {
      const claims = await prisma.claim.findMany({
        where: { workspaceId: ws },
        include: { sources: true },
        orderBy: { createdAt: "asc" },
      });
      return claims.map((c) => ({
        id: c.id,
        statement: c.statement,
        classification: c.classification,
        status: c.status,
        confidence: c.confidence,
        publicWording: c.publicWording,
        sourceCount: c.sources.length,
        lastReviewedAt: c.lastReviewedAt?.toISOString() ?? "",
        createdAt: c.createdAt.toISOString(),
      }));
    }
    case "sources": {
      const sources = await prisma.source.findMany({
        where: { workspaceId: ws },
        orderBy: { createdAt: "asc" },
      });
      return sources.map((s) => ({
        id: s.id,
        title: s.title,
        publisher: s.publisher,
        url: s.url ?? "",
        sourceClass: s.sourceClass,
        status: s.status,
        factualAsOfDate: s.factualAsOfDate?.toISOString() ?? "",
        createdAt: s.createdAt.toISOString(),
      }));
    }
    case "content": {
      const items = await prisma.contentItem.findMany({
        where: { workspaceId: ws, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
      return items.map((c) => ({
        id: c.id,
        workingTitle: c.workingTitle,
        type: c.type,
        pillar: c.pillar,
        status: c.status,
        spoilerLevel: c.spoilerLevel,
        priority: c.priority,
        slug: c.slug ?? "",
        createdAt: c.createdAt.toISOString(),
      }));
    }
    case "audit": {
      const events = await prisma.auditEvent.findMany({
        where: { workspaceId: ws },
        orderBy: { createdAt: "asc" },
        take: 5000,
      });
      return events.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        actorId: e.actorId ?? "",
        metadata: e.metadataJson ?? "",
        createdAt: e.createdAt.toISOString(),
      }));
    }
  }
}

export async function buildExport(
  actor: Actor,
  type: ExportType,
  format: ExportFormat,
): Promise<{ body: string; contentType: string; filename: string }> {
  const rows = await collect(actor, type);
  if (format === "json") {
    return {
      body: JSON.stringify({ type, exportedAt: new Date().toISOString(), rows }, null, 2),
      contentType: "application/json",
      filename: `${type}.json`,
    };
  }
  return { body: toCsv(rows), contentType: "text/csv", filename: `${type}.csv` };
}
