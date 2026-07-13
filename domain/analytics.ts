import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";

const snapshotSchema = z.object({
  contentId: z.string(),
  platform: z.string().default("youtube"),
  snapshotAt: z.coerce.date().optional(),
  impressions: z.number().int().nonnegative().optional(),
  views: z.number().int().nonnegative().optional(),
  ctr: z.number().min(0).max(1).optional(),
  firstThirtySecondRetention: z.number().min(0).max(1).optional(),
  averagePercentageViewed: z.number().min(0).max(1).optional(),
  watchHours: z.number().nonnegative().optional(),
  subscribersGained: z.number().int().optional(),
  shortsToLongClicks: z.number().int().nonnegative().optional(),
});

export async function importAnalyticsSnapshot(actor: Actor, raw: z.input<typeof snapshotSchema>) {
  require_(actor, "analytics.import");
  const input = snapshotSchema.parse(raw);

  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");

  const snapshot = await prisma.analyticsSnapshot.create({
    data: {
      contentId: input.contentId,
      platform: input.platform,
      snapshotAt: input.snapshotAt ?? new Date(),
      impressions: input.impressions,
      views: input.views,
      ctr: input.ctr,
      firstThirtySecondRetention: input.firstThirtySecondRetention,
      averagePercentageViewed: input.averagePercentageViewed,
      watchHours: input.watchHours,
      subscribersGained: input.subscribersGained,
      shortsToLongClicks: input.shortsToLongClicks,
      importedBy: actor.userId,
    },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "analytics.imported",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { snapshotId: snapshot.id, platform: input.platform },
  });

  return snapshot;
}

export interface ScorecardSignal {
  label: string;
  value: string;
  status: "good" | "watch" | "weak" | "na";
  note: string;
}

// Manual-first scorecard: qualitative reads from the latest snapshot. Thresholds
// are heuristics for a discovery-stage channel, never causal certainty from weak data.
export function scorecardSignals(
  snapshot: {
    ctr: number | null;
    firstThirtySecondRetention: number | null;
    averagePercentageViewed: number | null;
  } | null,
): ScorecardSignal[] {
  if (!snapshot) return [];
  const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

  const ctr: ScorecardSignal = {
    label: "Click-through rate",
    value: pct(snapshot.ctr),
    status:
      snapshot.ctr == null
        ? "na"
        : snapshot.ctr >= 0.08
          ? "good"
          : snapshot.ctr >= 0.04
            ? "watch"
            : "weak",
    note: "Packaging (title/thumbnail) signal. Compare variants before concluding.",
  };
  const hook: ScorecardSignal = {
    label: "First 30s retention",
    value: pct(snapshot.firstThirtySecondRetention),
    status:
      snapshot.firstThirtySecondRetention == null
        ? "na"
        : snapshot.firstThirtySecondRetention >= 0.7
          ? "good"
          : snapshot.firstThirtySecondRetention >= 0.5
            ? "watch"
            : "weak",
    note: "Hook/intro signal. A weak hook caps everything downstream.",
  };
  const depth: ScorecardSignal = {
    label: "Average % viewed",
    value: pct(snapshot.averagePercentageViewed),
    status:
      snapshot.averagePercentageViewed == null
        ? "na"
        : snapshot.averagePercentageViewed >= 0.45
          ? "good"
          : snapshot.averagePercentageViewed >= 0.3
            ? "watch"
            : "weak",
    note: "Body/structure signal. Consider tightening the middle.",
  };
  return [ctr, hook, depth];
}
