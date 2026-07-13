import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  // Draft/staging safety: only allow indexing when explicitly enabled.
  const indexable = process.env.PUBLIC_SITE_INDEXABLE === "true";
  return {
    rules: indexable
      ? { userAgent: "*", allow: "/", disallow: ["/studio", "/signin", "/api"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${base}/sitemap.xml`,
  };
}
