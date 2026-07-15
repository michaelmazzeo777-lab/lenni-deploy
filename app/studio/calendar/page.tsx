import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { humanStatus } from "@/app/_ui";

export const metadata = { title: "Calendar — Field Guide Studio" };
export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function CalendarPage() {
  const actor = await requireStudioActor();
  const items = await prisma.contentItem.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null, dueAt: { not: null } },
    orderBy: { dueAt: "asc" },
  });

  const today = startOfDay(new Date());
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const groups: { label: string; items: typeof items }[] = [
    { label: "Overdue", items: [] },
    { label: "Due this week", items: [] },
    { label: "Later", items: [] },
  ];
  for (const item of items) {
    const due = item.dueAt!;
    if (due < today && item.status !== "PUBLISHED" && item.status !== "ARCHIVED") {
      groups[0]!.items.push(item);
    } else if (due <= weekEnd) {
      groups[1]!.items.push(item);
    } else {
      groups[2]!.items.push(item);
    }
  }

  const noDate = await prisma.contentItem.count({
    where: { workspaceId: actor.workspaceId, deletedAt: null, dueAt: null },
  });

  return (
    <div>
      <h1>Content calendar</h1>
      <p className="muted">
        Scheduled by due date. {noDate} item(s) have no due date and are not shown.
      </p>

      {groups.map((g) => (
        <div className="card" key={g.label}>
          <h2>
            {g.label} ({g.items.length})
          </h2>
          <table>
            <thead>
              <tr>
                <th>Due</th>
                <th>Title</th>
                <th>Status</th>
                <th>Not before</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((item) => (
                <tr key={item.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {item.dueAt!.toISOString().slice(0, 10)}
                  </td>
                  <td>
                    <Link href={`/studio/content/${item.id}`}>{item.workingTitle}</Link>
                  </td>
                  <td>{humanStatus(item.status)}</td>
                  <td className="muted">
                    {item.notBeforeAt ? item.notBeforeAt.toISOString().slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
              {g.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing scheduled.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
