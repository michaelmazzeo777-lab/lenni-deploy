import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export const metadata = { title: "Audit log — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await requireActor();
  const events = await prisma.auditEvent.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <h1>Audit log</h1>
      <p className="muted">Append-only. Enforced immutable at the database (no update/delete).</p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="muted">
                  {e.entityType}
                  <br />
                  <span style={{ fontSize: "0.72rem" }}>{e.entityId.slice(0, 10)}</span>
                </td>
                <td className="muted">{e.actorId ? e.actorId.slice(0, 8) : "system"}</td>
                <td className="muted" style={{ fontSize: "0.8rem" }}>
                  {e.metadataJson ? JSON.stringify(e.metadataJson) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
