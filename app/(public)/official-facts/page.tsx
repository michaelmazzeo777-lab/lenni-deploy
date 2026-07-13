import { prisma } from "@/lib/db";
import { Badge } from "@/app/_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Official Facts" };

// The Official Facts hub surfaces only CONFIRMED, reviewed claims with an active
// official source. Everything else is explicitly separated as "not confirmed".
export default async function OfficialFacts() {
  const confirmed = await prisma.claim.findMany({
    where: {
      classification: "CONFIRMED",
      status: "REVIEWED",
      sources: { some: { source: { sourceClass: "OFFICIAL_SOURCE", status: "ACTIVE" } } },
    },
    include: { sources: { include: { source: true } } },
    orderBy: { lastReviewedAt: "desc" },
  });

  const notConfirmed = await prisma.claim.findMany({
    where: {
      status: "REVIEWED",
      classification: { in: ["OBSERVED", "ANALYSIS", "PREDICTION", "RUMOR", "UNVERIFIED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div>
      <h1>Official Facts</h1>
      <p className="muted">
        Only claims explicitly confirmed by an official source appear here, with the current-as-of
        date shown per item.
      </p>

      <section className="card">
        <h2>Confirmed ({confirmed.length})</h2>
        {confirmed.length === 0 ? (
          <p className="muted">Nothing confirmed yet in this local workspace.</p>
        ) : (
          <ul>
            {confirmed.map((c) => (
              <li key={c.id} style={{ marginBottom: 8 }}>
                <Badge kind="CONFIRMED" /> {c.publicWording ?? c.statement}
                <div className="muted" style={{ fontSize: "0.78rem" }}>
                  Sources: {c.sources.map((s) => s.source.publisher).join(", ")}
                  {c.lastReviewedAt
                    ? ` · as of ${c.lastReviewedAt.toISOString().slice(0, 10)}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Not confirmed</h2>
        <p className="muted">
          Observations, analysis, predictions, and rumors are labeled and kept separate from
          official facts.
        </p>
        <ul>
          {notConfirmed.map((c) => (
            <li key={c.id}>
              <Badge kind={c.classification} /> {c.publicWording ?? c.statement}
            </li>
          ))}
          {notConfirmed.length === 0 ? <li className="muted">None recorded.</li> : null}
        </ul>
      </section>
    </div>
  );
}
