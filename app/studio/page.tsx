import Link from "next/link";
import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { humanStatus } from "@/app/_ui";

export const metadata = { title: "Dashboard — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const actor = await requireActor();
  const ws = actor.workspaceId;

  const [content, sources, claims, pendingClaims, generations, published, openCorrections] =
    await Promise.all([
      prisma.contentItem.count({ where: { workspaceId: ws, deletedAt: null } }),
      prisma.source.count({ where: { workspaceId: ws } }),
      prisma.claim.count({ where: { workspaceId: ws } }),
      prisma.claim.count({ where: { workspaceId: ws, status: "PROPOSED" } }),
      prisma.aIGeneration.count({ where: { workspaceId: ws } }),
      prisma.publication.count({ where: { status: "PUBLISHED" } }),
      prisma.correction.count({ where: { status: { not: "RESOLVED" } } }),
    ]);

  const recent = await prisma.contentItem.findMany({
    where: { workspaceId: ws, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  const stats = [
    { label: "Content items", value: content },
    { label: "Sources", value: sources },
    { label: "Claims", value: claims },
    { label: "Claims to review", value: pendingClaims },
    { label: "AI generations", value: generations },
    { label: "Published", value: published },
    { label: "Open corrections", value: openCorrections },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">
        Draft — Pending Mike Review — Live Validation Required. Local development workspace.
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        {stats.map((s) => (
          <div className="card" key={s.label} style={{ marginBottom: 0 }}>
            <div style={{ fontSize: "2rem", fontWeight: 800 }}>{s.value}</div>
            <div className="muted">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Recent content</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/studio/content/${c.id}`}>{c.workingTitle}</Link>
                </td>
                <td className="muted">{humanStatus(c.type)}</td>
                <td>{humanStatus(c.status)}</td>
                <td className="muted">{c.updatedAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {recent.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No content yet. <Link href="/studio/content">Create one →</Link>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
