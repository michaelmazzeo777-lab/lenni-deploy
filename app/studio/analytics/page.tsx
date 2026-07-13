import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { scorecardSignals } from "@/domain/analytics";
import { Banner } from "@/app/_ui";
import { importAnalyticsAction } from "@/app/studio/growth-actions";

export const metadata = { title: "Analytics — Field Guide Studio" };
export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  good: "CONFIRMED",
  watch: "ANALYSIS",
  weak: "RUMOR",
  na: "UNVERIFIED",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { error } = await searchParams;

  const items = await prisma.contentItem.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    include: { analytics: { orderBy: { snapshotAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  const withData = items.filter((i) => i.analytics.length > 0);
  const mayImport = can(actor, "analytics.import");

  return (
    <div>
      <h1>Analytics snapshots</h1>
      <p className="muted">
        Manual-first. Signals are heuristic reads, never causal certainty from weak data. Compare
        variants before concluding.
      </p>
      <Banner error={error} />

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 520px" }}>
          <h2>Scorecards ({withData.length})</h2>
          {withData.length === 0 ? <p className="muted">No snapshots imported yet.</p> : null}
          {withData.map((item) => {
            const snap = item.analytics[0]!;
            const signals = scorecardSignals(snap);
            return (
              <div key={item.id} style={{ marginBottom: 18 }}>
                <strong>{item.workingTitle}</strong>{" "}
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  · {snap.platform} · {snap.views ?? "—"} views ·{" "}
                  {snap.snapshotAt.toISOString().slice(0, 10)}
                </span>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  {signals.map((sig) => (
                    <div
                      key={sig.label}
                      className="card"
                      style={{ flex: "1 1 160px", margin: 0, padding: 12 }}
                    >
                      <div className={`badge ${STATUS_CLASS[sig.status]}`}>{sig.status}</div>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{sig.value}</div>
                      <div className="muted" style={{ fontSize: "0.78rem" }}>
                        {sig.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {mayImport ? (
          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>Import a snapshot</h2>
            <form action={importAnalyticsAction}>
              <label htmlFor="contentId">Content item</label>
              <select id="contentId" name="contentId" required>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.workingTitle.slice(0, 50)}
                  </option>
                ))}
              </select>
              <label htmlFor="platform">Platform</label>
              <input id="platform" name="platform" defaultValue="youtube" />
              <label htmlFor="impressions">Impressions</label>
              <input id="impressions" name="impressions" type="number" min={0} />
              <label htmlFor="views">Views</label>
              <input id="views" name="views" type="number" min={0} />
              <label htmlFor="ctr">CTR (0–1, e.g. 0.08)</label>
              <input id="ctr" name="ctr" type="number" step="0.001" min={0} max={1} />
              <label htmlFor="firstThirtySecondRetention">First-30s retention (0–1)</label>
              <input
                id="firstThirtySecondRetention"
                name="firstThirtySecondRetention"
                type="number"
                step="0.01"
                min={0}
                max={1}
              />
              <label htmlFor="averagePercentageViewed">Average % viewed (0–1)</label>
              <input
                id="averagePercentageViewed"
                name="averagePercentageViewed"
                type="number"
                step="0.01"
                min={0}
                max={1}
              />
              <label htmlFor="subscribersGained">Subscribers gained</label>
              <input id="subscribersGained" name="subscribersGained" type="number" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Import snapshot</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
