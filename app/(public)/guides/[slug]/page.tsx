import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedArticleBySlug } from "@/lib/publicData";
import { renderMarkdown } from "@/lib/markdown";
import { Badge, humanStatus } from "@/app/_ui";

export const dynamic = "force-dynamic";

interface SourceRef {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
}
interface ClaimRef {
  id: string;
  classification: string;
  statement: string;
  publicWording: string | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) return { title: "Not found" };
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: `${base}/guides/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.summary,
      url: `${base}/guides/${article.slug}`,
      type: "article",
    },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();

  const sources = (article.sourceSnapshot as unknown as SourceRef[]) ?? [];
  const claims = (article.claimSnapshot as unknown as ClaimRef[]) ?? [];
  const classifications = [...new Set(claims.map((c) => c.classification))];
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt.toISOString(),
    dateModified: article.lastVerifiedAt.toISOString(),
    url: `${base}/guides/${article.slug}`,
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: "Leonida Field Guide (independent fan publication)",
    },
  };

  return (
    <article className="narrow">
      <script
        type="application/ld+json"
        // JSON.stringify does not escape "</script>"; encode "<" so a title
        // containing markup can never break out of this script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="muted" style={{ fontSize: "0.8rem" }}>
        {humanStatus(article.pillar)}
      </div>
      <h1>{article.title}</h1>
      <p className="muted">{article.summary}</p>
      <div className="article-meta">
        <Badge kind="spoiler" label={`Spoiler: ${humanStatus(article.spoilerLevel)}`} />
        <span>Published {article.publishedAt.toISOString().slice(0, 10)}</span>
        <span>· Last verified {article.lastVerifiedAt.toISOString().slice(0, 10)}</span>
        <span>· Revision {article.revision}</span>
      </div>

      {classifications.length ? (
        <div className="card" style={{ padding: "12px 16px" }}>
          <strong style={{ fontSize: "0.85rem" }}>Classification key: </strong>
          {classifications.map((c) => (
            <span key={c} style={{ marginRight: 6 }}>
              <Badge kind={c} />
            </span>
          ))}
        </div>
      ) : null}

      <div className="article-body">{renderMarkdown(article.body)}</div>

      {sources.length ? (
        <section>
          <h2>Source references</h2>
          <ol>
            {sources.map((sce) => (
              <li key={sce.id}>
                {sce.url ? (
                  <a href={sce.url} target="_blank" rel="noreferrer noopener nofollow">
                    {sce.title}
                  </a>
                ) : (
                  sce.title
                )}{" "}
                <span className="muted">— {sce.publisher}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="disclaimer">{article.disclaimer}</p>
    </article>
  );
}
