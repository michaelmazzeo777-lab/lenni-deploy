import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner, humanStatus } from "@/app/_ui";
import { createContentAction } from "@/app/studio/actions";

export const metadata = { title: "Content backlog — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function ContentListPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;
  const items = await prisma.contentItem.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    take: 500, // bound the page; pagination becomes worthwhile well before this
  });
  const mayCreate = can(actor, "content.create");

  return (
    <div>
      <h1>Content backlog</h1>
      <Banner error={error} />

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 520px" }}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type / Pillar</th>
                <th>Status</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/studio/content/${c.id}`}>{c.workingTitle}</Link>
                  </td>
                  <td className="muted">
                    {humanStatus(c.type)}
                    <br />
                    {humanStatus(c.pillar)}
                  </td>
                  <td>{humanStatus(c.status)}</td>
                  <td>P{c.priority}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No content yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {mayCreate ? (
          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>New content idea</h2>
            <form action={createContentAction}>
              <label htmlFor="workingTitle">Working title</label>
              <input id="workingTitle" name="workingTitle" required minLength={3} />
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue="LONG_VIDEO">
                <option value="LONG_VIDEO">Long video</option>
                <option value="SHORT">Short</option>
                <option value="WEBSITE_GUIDE">Website guide</option>
                <option value="NEWS_BRIEFING">News briefing</option>
                <option value="EVIDENCE_ANALYSIS">Evidence analysis</option>
                <option value="EXPERIMENT">Experiment</option>
                <option value="DOCUMENTARY">Documentary</option>
              </select>
              <label htmlFor="pillar">Pillar</label>
              <select id="pillar" name="pillar" defaultValue="BRIEFING">
                <option value="BRIEFING">Briefing</option>
                <option value="EVIDENCE_BOARD">Evidence Board</option>
                <option value="FIELD_MANUAL">Field Manual</option>
                <option value="FIELD_LAB">Field Lab</option>
                <option value="LEONIDA_STORIES">Leonida Stories</option>
              </select>
              <label htmlFor="spoilerLevel">Spoiler level</label>
              <select id="spoilerLevel" name="spoilerLevel" defaultValue="NONE">
                <option value="NONE">None</option>
                <option value="PREMISE_ONLY">Premise only</option>
                <option value="EARLY_GAME">Early game</option>
                <option value="MIDGAME">Midgame</option>
                <option value="MAJOR_STORY">Major story</option>
                <option value="ENDING">Ending</option>
              </select>
              <label htmlFor="viewerPromise">Viewer promise</label>
              <textarea id="viewerPromise" name="viewerPromise" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Create idea</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
