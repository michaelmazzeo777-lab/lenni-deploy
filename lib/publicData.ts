import { prisma } from "@/lib/db";

// Returns the latest immutable revision for every content item that currently
// has a PUBLISHED public-website publication. Draft/unpublished content is never
// returned (docs/11 test 49).
export async function listPublishedArticles() {
  const pubs = await prisma.publication.findMany({
    where: { channel: "PUBLIC_WEBSITE", status: "PUBLISHED" },
    include: { content: true },
  });
  const results = [];
  for (const p of pubs) {
    const rev = await prisma.publicArticleRevision.findFirst({
      where: { contentId: p.contentId },
      orderBy: { revision: "desc" },
    });
    if (rev) results.push(rev);
  }
  results.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return results;
}

export async function getPublishedArticleBySlug(slug: string) {
  // Only serve if the content is currently PUBLISHED.
  const rev = await prisma.publicArticleRevision.findFirst({
    where: { slug },
    orderBy: { revision: "desc" },
  });
  if (!rev) return null;
  const pub = await prisma.publication.findUnique({
    where: { contentId_channel: { contentId: rev.contentId, channel: "PUBLIC_WEBSITE" } },
  });
  if (!pub || pub.status !== "PUBLISHED") return null;
  return rev;
}

export async function listPublicCorrections() {
  const corrections = await prisma.correction.findMany({
    where: { status: "RESOLVED" },
    orderBy: { resolvedAt: "desc" },
    include: { content: true },
  });
  // Only surface corrections for content that is published.
  const out = [];
  for (const c of corrections) {
    const pub = await prisma.publication.findUnique({
      where: { contentId_channel: { contentId: c.contentId, channel: "PUBLIC_WEBSITE" } },
    });
    if (pub?.status === "PUBLISHED") {
      const rev = await prisma.publicArticleRevision.findFirst({
        where: { contentId: c.contentId },
        orderBy: { revision: "desc" },
      });
      out.push({ correction: c, slug: rev?.slug ?? null });
    }
  }
  return out;
}
