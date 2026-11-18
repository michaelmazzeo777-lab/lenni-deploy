import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { toCanonicalRecord } from "@/domain/canonicalTaxonomy";
import { questionTerms, HELPER_BOUNDARY, HELPER_CHECKS } from "@/lib/research/helper";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gameplay research helper — Field Guide Studio" };

export default async function HelperPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const actor = await requireStudioActor();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 600);
  const scope = (params.scope ?? "").trim().slice(0, 200);
  const terms = questionTerms(q);
  const claims = terms.length
    ? await prisma.claim.findMany({
        where: {
          workspaceId: actor.workspaceId,
          classification: { not: "LEAKED" },
          OR: terms.map((term) => ({
            statement: { contains: term, mode: "insensitive" as const },
          })),
        },
        include: { sources: { include: { source: true } } },
        orderBy: { updatedAt: "desc" },
        take: 30,
      })
    : [];
  return (
    <div>
      <h1>Gameplay research helper</h1>
      <p>{HELPER_BOUNDARY}</p>
      <form method="get" className="card">
        <label htmlFor="question">Research question</label>
        <textarea id="question" name="q" minLength={8} maxLength={600} required defaultValue={q} />
        <label htmlFor="scope">Game, platform/build and spoiler ceiling</label>
        <input id="scope" name="scope" maxLength={200} defaultValue={scope} />
        <button type="submit">Find local evidence</button>
      </form>
      {q && (
        <section className="card">
          <h2>Evidence leads</h2>
          <p>{q}</p>
          <p>Scope: {scope || "Not specified — resolve before answering"}</p>
          {!claims.length && <p>No matching workspace evidence. Do not invent an answer.</p>}
          {claims.map((claim) => {
            const mapped = toCanonicalRecord(claim);
            return (
              <article key={claim.id}>
                <h3>{claim.statement}</h3>
                <p>
                  {mapped.canonical ?? "QUARANTINED"} · {claim.status} · {claim.id}
                </p>
                {mapped.reasons.length > 0 && <p>{mapped.reasons.join("; ")}</p>}
                <ul>
                  {claim.sources.map(({ source }) => (
                    <li key={source.id}>
                      {source.title} — {source.publisher} · source {source.id}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      )}
      <section className="card">
        <h2>Before using a lead</h2>
        <ol>
          {HELPER_CHECKS.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ol>
        <Link href="/studio/sources">Open source records</Link>
        {" · "}
        <Link href="/studio/claims">Open claim ledger</Link>
        {" · "}
        <Link href="/studio/content">Continue to production backlog</Link>
      </section>
    </div>
  );
}
