import { createHash } from "node:crypto";
import type { Tx } from "@/lib/db";
import { prisma } from "@/lib/db";

export interface AuditInput {
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

// Writes an append-only audit event. Pass a transaction client to keep the
// event atomic with the state change it records.
export async function writeAudit(input: AuditInput, tx?: Tx): Promise<void> {
  const client = tx ?? prisma;
  await client.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorType: input.actorId ? "USER" : "SYSTEM",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: (input.before as object) ?? undefined,
      afterJson: (input.after as object) ?? undefined,
      metadataJson: (input.metadata as object) ?? undefined,
      requestId: input.requestId,
    },
  });
}

// Stable hash of the material fields that define an approvable content state.
// A change to any of these invalidates prior approvals (docs/06 change invalidation).
export function contentRevisionHash(parts: {
  workingTitle: string;
  publicTitle: string | null;
  spoilerLevel: string;
  scriptBody: string | null;
  claimIds: string[];
  assetIds: string[];
  thumbnailIds: string[];
}): string {
  const canonical = JSON.stringify({
    workingTitle: parts.workingTitle,
    publicTitle: parts.publicTitle,
    spoilerLevel: parts.spoilerLevel,
    scriptBody: parts.scriptBody,
    claimIds: [...parts.claimIds].sort(),
    assetIds: [...parts.assetIds].sort(),
    thumbnailIds: [...parts.thumbnailIds].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
