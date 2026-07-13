import type { MetadataRoute } from "next";
import { listPublishedArticles } from "@/lib/publicData";

// Generated per-request so the production build never requires a database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const staticPaths = ["", "/official-facts", "/guides", "/corrections", "/methodology", "/about"];
  const articles = await listPublishedArticles();

  return [
    ...staticPaths.map((p) => ({ url: `${base}${p}`, lastModified: new Date() })),
    // Only published articles are included; drafts are never routable (test 57).
    ...articles.map((a) => ({
      url: `${base}/guides/${a.slug}`,
      lastModified: a.lastVerifiedAt,
    })),
  ];
}
