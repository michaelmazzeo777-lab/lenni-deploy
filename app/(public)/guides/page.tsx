import Link from "next/link";
import { listPublishedArticles } from "@/lib/publicData";
import { humanStatus } from "@/app/_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guides" };

export default async function GuidesIndex() {
  const articles = await listPublishedArticles();
  return (
    <div>
      <h1>Guides &amp; evidence articles</h1>
      {articles.length === 0 ? (
        <p className="muted">No published articles yet.</p>
      ) : (
        <ul>
          {articles.map((a) => (
            <li key={a.id} style={{ marginBottom: 10 }}>
              <Link href={`/guides/${a.slug}`}>{a.title}</Link>{" "}
              <span className="muted">— {humanStatus(a.pillar)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
