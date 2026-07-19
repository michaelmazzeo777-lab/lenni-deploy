import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { invalidTransition, precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { evaluateReadyReadiness } from "@/domain/approval";
import { rightsBlockers } from "@/domain/rights";
import { ContentStatus } from "@prisma/client";

// Linear workflow order (docs/06_EDITORIAL_WORKFLOWS.md).
export const WORKFLOW_ORDER: ContentStatus[] = [
  ContentStatus.IDEA,
  ContentStatus.TRIAGE,
  ContentStatus.RESEARCH,
  ContentStatus.EVIDENCE_READY,
  ContentStatus.OUTLINE,
  ContentStatus.SCRIPT_DRAFT,
  ContentStatus.SCRIPT_REVIEW,
  ContentStatus.PRODUCTION,
  ContentStatus.EDIT_REVIEW,
  ContentStatus.PACKAGING,
  ContentStatus.RIGHTS_REVIEW,
  ContentStatus.APPROVAL,
  ContentStatus.READY,
  ContentStatus.PUBLISHED,
  ContentStatus.UPDATE_DUE,
  ContentStatus.ARCHIVED,
];

function indexOf(status: ContentStatus): number {
  return WORKFLOW_ORDER.indexOf(status);
}

// Guard functions run inside the transition transaction. They throw on failure.
type Guard = (contentId: string, tx: Tx) => Promise<void>;

const GUARDS: Partial<Record<ContentStatus, Guard>> = {
  async EVIDENCE_READY(contentId, tx) {
    const sources = await tx.source.count({
      where: { workspaceId: (await item(contentId, tx)).workspaceId, status: "ACTIVE" },
    });
    const reviewedClaims = await tx.contentClaim.count({
      where: { contentId, claim: { status: "REVIEWED" } },
    });
    if (sources < 1) throw precondition("EVIDENCE_READY requires at least one active source");
    if (reviewedClaims < 1)
      throw precondition("EVIDENCE_READY requires at least one reviewed, linked claim");
  },
  async SCRIPT_REVIEW(contentId, tx) {
    const script = await tx.scriptVersion.count({ where: { contentId } });
    if (script < 1) throw precondition("SCRIPT_REVIEW requires a current script version");
  },
  async RIGHTS_REVIEW(contentId, tx) {
    const assets = await tx.asset.count({ where: { contentId } });
    if (assets < 1)
      throw precondition("RIGHTS_REVIEW requires an asset ledger (at least one asset)");
    const titles = await tx.titleVariant.count({ where: { contentId } });
    const thumbs = await tx.thumbnailVariant.count({ where: { contentId } });
    if (titles < 1 || thumbs < 1)
      throw precondition("Packaging requires at least one title and one thumbnail brief");
  },
  async APPROVAL(contentId, tx) {
    const blockers = await rightsBlockers(contentId, tx);
    if (blockers.length > 0)
      throw precondition("Cannot advance to APPROVAL with blocking assets", blockers);
  },
  async READY(contentId, tx) {
    const r = await evaluateReadyReadiness(contentId, tx);
    if (!r.ready) {
      throw precondition("READY preconditions not met", {
        missingScopes: r.missingScopes,
        rightsBlockers: r.rightsBlockers,
        blockingCorrections: r.blockingCorrections,
      });
    }
  },
};

async function item(contentId: string, tx: Tx) {
  const c = await tx.contentItem.findUnique({ where: { id: contentId } });
  if (!c) throw notFound("Content item not found");
  return c;
}

export interface TransitionOptions {
  reason?: string;
  override?: boolean; // owner-only skip
}

export async function transition(
  actor: Actor,
  contentId: string,
  to: ContentStatus,
  opts: TransitionOptions = {},
) {
  const isOverride = opts.override === true;
  require_(actor, isOverride ? "content.transition.override" : "content.transition");

  return prisma.$transaction(async (tx) => {
    const content = await item(contentId, tx);
    if (content.workspaceId !== actor.workspaceId) throw notFound("Content item not found");

    const from = content.status;
    const fromIdx = indexOf(from);
    const toIdx = indexOf(to);
    if (toIdx < 0) throw invalidTransition(`Unknown target status ${to}`);

    const isForwardOne = toIdx === fromIdx + 1;
    const isBackward = toIdx < fromIdx;

    // Default: only the immediate next step, or a backward move (e.g. rework).
    // Any skip forward requires an owner override with a recorded reason.
    if (!isForwardOne && !isBackward && !isOverride) {
      throw invalidTransition(
        `Cannot move ${from} → ${to} directly; use the next step or an owner override`,
      );
    }
    if (isOverride && !opts.reason) {
      throw precondition("Status override requires a reason");
    }

    // Run the target guard unless this is an explicit override.
    if (!isOverride) {
      const guard = GUARDS[to];
      if (guard) await guard(contentId, tx);
    }

    // Guarded write: only applies if the status is still what we read above,
    // so two concurrent transitions from the same status cannot both win.
    const { count } = await tx.contentItem.updateMany({
      where: { id: contentId, status: from },
      data: { status: to },
    });
    if (count === 0) {
      throw precondition("Content status changed concurrently; reload and retry");
    }
    const updated = await item(contentId, tx);

    await tx.contentStatusHistory.create({
      data: {
        contentId,
        fromStatus: from,
        toStatus: to,
        actorId: actor.userId,
        reason: opts.reason,
      },
    });

    await writeAudit(
      {
        workspaceId: content.workspaceId,
        actorId: actor.userId,
        action: "content.transitioned",
        entityType: "ContentItem",
        entityId: contentId,
        before: { status: from },
        after: { status: to },
        metadata: { override: isOverride, reason: opts.reason ?? null },
      },
      tx,
    );

    return updated;
  });
}
