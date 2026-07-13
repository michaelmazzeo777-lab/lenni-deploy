import Link from "next/link";
import { listPublishedArticles, listPublicCorrections } from "@/lib/publicData";
import { humanStatus } from "@/app/_ui";

export const dynamic = "force-dynamic";

export default async function PublicHome() {
  const [articles, corrections] = await Promise.all([
    listPublishedArticles(),
    listPublicCorrections(),
  ]);

  return (
    <div>
      <section className="card">
        <h1>Leonida Field Guide</h1>
        <p>
          An independent GTA VI fan publication. We separate <strong>official facts</strong> from
          observation, analysis, prediction, and rumor — and we never use leaked material.
        </p>
        <p>
          <Link href="/official-facts" className="btn">
            See what&apos;s officially confirmed
          </Link>
        </p>
      </section>

      <h2>Latest guides &amp; evidence</h2>
      {articles.length === 0 ? (
        <p className="muted">No published articles yet.</p>
      ) : (
        <div className="grid">
          {articles.map((a) => (
            <article className="card" key={a.id} style={{ marginBottom: 0 }}>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                {humanStatus(a.pillar)} · Spoiler: {humanStatus(a.spoilerLevel)}
              </div>
              <h3 style={{ margin: "6px 0" }}>
                <Link href={`/guides/${a.slug}`}>{a.title}</Link>
              </h3>
              <p className="muted">{a.summary}</p>
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                Last verified {a.lastVerifiedAt.toISOString().slice(0, 10)} · rev {a.revision}
              </div>
            </article>
          ))}
        </div>
      )}

      {corrections.length ? (
        <section className="card" style={{ marginTop: 20 }}>
          <h2>Recent corrections</h2>
          <ul>
            {corrections.slice(0, 5).map(({ correction, slug }) => (
              <li key={correction.id}>
                {slug ? (
                  <Link href={`/guides/${slug}`}>{correction.publicNotice}</Link>
                ) : (
                  correction.publicNotice
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
