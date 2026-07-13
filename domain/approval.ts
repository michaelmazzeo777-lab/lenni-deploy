import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { precondition } from "@/lib/errors";
import { requireScope } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { gatherContentState } from "@/domain/content";
import { rightsBlockers } from "@/domain/rights";
import { ApprovalScope, ApprovalDecision } from "@prisma/client";

// Scopes that must all be approved (against the CURRENT revision hash) before
// a content item may reach READY (docs/06 APPROVAL → READY).
export const READY_REQUIRED_SCOPES: ApprovalScope[] = [
  ApprovalScope.EDITORIAL_FACTS,
  ApprovalScope.SCRIPT,
  ApprovalScope.RIGHTS,
  ApprovalScope.PACKAGING,
  ApprovalScope.PUBLIC_WEBSITE,
];

export async function grantApproval(
  actor: Actor,
  contentId: string,
  scope: ApprovalScope,
  decision: ApprovalDecision,
  notes?: string,
) {
  requireScope(actor, scope);

  return prisma.$transaction(async (tx) => {
    const { content, hash } = await gatherContentState(contentId, tx);

    // Rights scope cannot be approved while a blocking asset exists.
    if (scope === ApprovalScope.RIGHTS && decision === ApprovalDecision.APPROVED) {
      const blockers = await rightsBlockers(contentId, tx);
      if (blockers.length > 0) {
        throw precondition("Cannot approve rights: blocking assets present", blockers);
      }
    }

    // Supersede any prior live approval for this exact scope.
    await tx.approval.updateMany({
      where: { contentId, scope, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: actor.userId },
    });

    const approval = await tx.approval.create({
      data: {
        contentId,
        scope,
        decision,
        notes,
        actorId: actor.userId,
        contentRevisionHash: hash,
      },
    });

    await writeAudit(
      {
        workspaceId: content.workspaceId,
        actorId: actor.userId,
        action: "approval.granted",
        entityType: "ContentItem",
        entityId: contentId,
        metadata: { scope, decision, approvalId: approval.id, revisionHash: hash },
      },
      tx,
    );

    return approval;
  });
}

export async function revokeApproval(actor: Actor, approvalId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUniqueOrThrow({ where: { id: approvalId } });
    requireScope(actor, approval.scope);
    const updated = await tx.approval.update({
      where: { id: approvalId },
      data: { revokedAt: new Date(), revokedBy: actor.userId },
    });
    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "approval.revoked",
        entityType: "ContentItem",
        entityId: approval.contentId,
        metadata: { scope: approval.scope, approvalId, reason },
      },
      tx,
    );
    return updated;
  });
}

// Revokes approvals whose recorded revision hash no longer matches the current
// content state — i.e. material edits invalidate prior approvals (docs/06).
export async function invalidateStaleApprovals(
  actor: Actor,
  contentId: string,
  tx: Tx,
  reason: string,
): Promise<number> {
  const { content, hash } = await gatherContentState(contentId, tx);
  const stale = await tx.approval.findMany({
    where: { contentId, revokedAt: null, decision: ApprovalDecision.APPROVED },
  });
  let count = 0;
  for (const a of stale) {
    if (a.contentRevisionHash !== hash) {
      await tx.approval.update({
        where: { id: a.id },
        data: { revokedAt: new Date(), revokedBy: actor.userId },
      });
      await writeAudit(
        {
          workspaceId: content.workspaceId,
          actorId: actor.userId,
          action: "approval.invalidated",
          entityType: "ContentItem",
          entityId: contentId,
          metadata: { scope: a.scope, approvalId: a.id, reason },
        },
        tx,
      );
      count++;
    }
  }
  return count;
}

export interface ReadyReadiness {
  ready: boolean;
  missingScopes: ApprovalScope[];
  rightsBlockers: string[];
  blockingCorrections: number;
}

// Evaluates whether a content item satisfies all READY preconditions.
export async function evaluateReadyReadiness(
  contentId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<ReadyReadiness> {
  const { hash } = await gatherContentState(contentId, tx);
  const live = await tx.approval.findMany({
    where: { contentId, revokedAt: null, decision: ApprovalDecision.APPROVED },
  });
  const validScopes = new Set(
    live.filter((a) => a.contentRevisionHash === hash).map((a) => a.scope),
  );
  const missingScopes = READY_REQUIRED_SCOPES.filter((s) => !validScopes.has(s));

  const blockers = await rightsBlockers(contentId, tx);

  const blockingCorrections = await tx.correction.count({
    where: {
      contentId,
      status: { not: "RESOLVED" },
      severity: { in: ["MAJOR", "MODERATE"] },
    },
  });

  return {
    ready: missingScopes.length === 0 && blockers.length === 0 && blockingCorrections === 0,
    missingScopes,
    rightsBlockers: blockers,
    blockingCorrections,
  };
}
