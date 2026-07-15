import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner, humanStatus } from "@/app/_ui";
import { markSourceStaleAction, resolveUpdateTaskAction } from "@/app/studio/growth-actions";

export const metadata = { title: "Update queue — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;
  const now = new Date();

  const [openTasks, staleSources, activeSources] = await Promise.all([
    prisma.updateTask.findMany({
      where: { status: "OPEN", content: { workspaceId: actor.workspaceId } },
      include: { content: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.source.findMany({
      where: {
        workspaceId: actor.workspaceId,
        OR: [{ status: "STALE" }, { staleAfter: { lt: now } }],
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.source.findMany({
      where: { workspaceId: actor.workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const mayResolve = can(actor, "content.edit");
  const mayStale = can(actor, "source.edit");

  return (
    <div>
      <h1>Update queue &amp; stale evidence</h1>
      <Banner error={error} />

      <div className="card">
        <h2>Open update tasks ({openTasks.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Content</th>
              <th>Trigger</th>
              <th>Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {openTasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/studio/content/${t.contentId}?tab=corrections`}>
                    {t.content.workingTitle}
                  </Link>
                </td>
                <td className="muted">{humanStatus(t.triggerType)}</td>
                <td className="muted">{t.createdAt.toISOString().slice(0, 10)}</td>
                <td>
                  {mayResolve ? (
                    <form action={resolveUpdateTaskAction}>
                      <input type="hidden" name="taskId" value={t.id} />
                      <button type="submit" className="secondary">
                        Resolve
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {openTasks.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No open update tasks.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 460px" }}>
          <h2>Stale / at-risk sources ({staleSources.length})</h2>
          <ul>
            {staleSources.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong> <span className="muted">— {s.publisher}</span>{" "}
                <span className="badge">{s.status}</span>
              </li>
            ))}
            {staleSources.length === 0 ? <li className="muted">None.</li> : null}
          </ul>
        </div>

        {mayStale ? (
          <div className="card" style={{ flex: "1 1 300px" }}>
            <h2>Flag a source as stale</h2>
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              Opens update tasks for every content item relying on that source.
            </p>
            <form action={markSourceStaleAction}>
              <label htmlFor="sourceId">Source</label>
              <select id="sourceId" name="sourceId" required>
                {activeSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.publisher}: {s.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <label htmlFor="reason">Reason</label>
              <input id="reason" name="reason" placeholder="Superseded by newer official info" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Mark stale</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
