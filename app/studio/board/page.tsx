import Link from "next/link";
import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { WORKFLOW_ORDER } from "@/domain/workflow";
import { humanStatus } from "@/app/_ui";

export const metadata = { title: "Production board — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const actor = await requireActor();
  const items = await prisma.contentItem.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
  });

  const byStatus = new Map<string, typeof items>();
  for (const status of WORKFLOW_ORDER) byStatus.set(status, []);
  for (const item of items) byStatus.get(item.status)!.push(item);

  // Show active columns first; hide empty terminal columns to reduce noise.
  const columns = WORKFLOW_ORDER.filter(
    (s) => byStatus.get(s)!.length > 0 || !["ARCHIVED", "UPDATE_DUE"].includes(s),
  );

  return (
    <div>
      <h1>Production board</h1>
      <p className="muted">Content grouped by workflow state. Priority-ordered within a column.</p>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12 }}>
        {columns.map((status) => {
          const col = byStatus.get(status)!;
          return (
            <section
              key={status}
              aria-label={humanStatus(status)}
              style={{ flex: "0 0 240px", minWidth: 240 }}
            >
              <div
                className="card"
                style={{ marginBottom: 8, padding: "8px 12px", position: "sticky", top: 0 }}
              >
                <strong style={{ fontSize: "0.82rem" }}>{humanStatus(status)}</strong>{" "}
                <span className="muted">({col.length})</span>
              </div>
              {col.map((item) => (
                <Link
                  key={item.id}
                  href={`/studio/content/${item.id}`}
                  className="card"
                  style={{ display: "block", padding: 12, marginBottom: 8 }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.workingTitle}</div>
                  <div className="muted" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                    {humanStatus(item.type)} · P{item.priority}
                  </div>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
