import Link from "next/link";
import { listPublicCorrections } from "@/lib/publicData";

export const dynamic = "force-dynamic";
export const metadata = { title: "Corrections" };

export default async function CorrectionsPage() {
  const items = await listPublicCorrections();
  return (
    <div>
      <h1>Corrections</h1>
      <p className="muted">
        When we get something wrong, we fix it in the open and record what changed and why.
      </p>
      {items.length === 0 ? (
        <p className="muted">No corrections recorded.</p>
      ) : (
        <ul>
          {items.map(({ correction, slug }) => (
            <li key={correction.id} style={{ marginBottom: 12 }}>
              <strong>{correction.severity}</strong> —{" "}
              {slug ? (
                <Link href={`/guides/${slug}`}>{correction.publicNotice}</Link>
              ) : (
                correction.publicNotice
              )}
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                {correction.resolvedAt?.toISOString().slice(0, 10)} · Reason: {correction.reason}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
