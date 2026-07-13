import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner, Badge } from "@/app/_ui";
import { createClaimAction, reviewClaimAction } from "@/app/studio/actions";

export const metadata = { title: "Claims — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { error } = await searchParams;

  const [claims, sources] = await Promise.all([
    prisma.claim.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: "desc" },
      include: { sources: { include: { source: true } } },
    }),
    prisma.source.findMany({
      where: { workspaceId: actor.workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const mayCreate = can(actor, "claim.create");
  const mayReview = can(actor, "claim.review");

  return (
    <div>
      <h1>Claim ledger</h1>
      <Banner error={error} />

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 480px" }}>
          <h2>Claims ({claims.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Statement</th>
                <th>Class</th>
                <th>Status</th>
                <th>Sources</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>{c.statement}</td>
                  <td>
                    <Badge kind={c.classification} />
                  </td>
                  <td>{c.status}</td>
                  <td className="muted">
                    {c.sources.map((cs) => cs.source.publisher).join(", ") || "—"}
                  </td>
                  <td>
                    {mayReview && c.status === "PROPOSED" ? (
                      <form action={reviewClaimAction}>
                        <input type="hidden" name="claimId" value={c.id} />
                        <input type="hidden" name="back" value="/studio/claims" />
                        <button type="submit" className="secondary">
                          Mark reviewed
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No claims yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {mayCreate ? (
          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>Create a claim</h2>
            <form action={createClaimAction}>
              <label htmlFor="statement">Exact claim</label>
              <textarea id="statement" name="statement" required />
              <label htmlFor="classification">Classification</label>
              <select id="classification" name="classification" defaultValue="CONFIRMED">
                <option value="CONFIRMED">Confirmed (needs official source)</option>
                <option value="OBSERVED">Observed</option>
                <option value="ANALYSIS">Analysis</option>
                <option value="PREDICTION">Prediction</option>
                <option value="RUMOR">Rumor</option>
                <option value="UNVERIFIED">Unverified</option>
                <option value="LEAKED">Leaked (auto-quarantined)</option>
              </select>
              <label htmlFor="publicWording">Public wording</label>
              <input id="publicWording" name="publicWording" />
              <label htmlFor="sourceIds">Supporting sources</label>
              <select id="sourceIds" name="sourceIds" multiple size={4}>
                {sources.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.publisher}: {sc.title} [{sc.sourceClass}]
                  </option>
                ))}
              </select>
              <label htmlFor="confidence">Confidence (1–5)</label>
              <input
                id="confidence"
                name="confidence"
                type="number"
                min={1}
                max={5}
                defaultValue={3}
              />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Create claim</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
