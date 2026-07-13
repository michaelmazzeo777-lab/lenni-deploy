import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { createSourceAction } from "@/app/studio/actions";

export const metadata = { title: "Sources — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { error } = await searchParams;
  const sources = await prisma.source.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const mayCreate = can(actor, "source.create");

  return (
    <div>
      <h1>Source registry</h1>
      <Banner error={error} />

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 480px" }}>
          <h2>Registered sources ({sources.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Publisher</th>
                <th>Class</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((sce) => (
                <tr key={sce.id}>
                  <td>
                    {sce.url ? (
                      <a href={sce.url} target="_blank" rel="noreferrer noopener">
                        {sce.title}
                      </a>
                    ) : (
                      sce.title
                    )}
                  </td>
                  <td className="muted">{sce.publisher}</td>
                  <td>
                    <span className="badge">{sce.sourceClass.replace(/_/g, " ")}</span>
                  </td>
                  <td>{sce.status}</td>
                </tr>
              ))}
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No sources yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {mayCreate ? (
          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>Register a source</h2>
            <form action={createSourceAction}>
              <label htmlFor="title">Title</label>
              <input id="title" name="title" required />
              <label htmlFor="publisher">Publisher / owner</label>
              <input id="publisher" name="publisher" required />
              <label htmlFor="url">URL (optional)</label>
              <input id="url" name="url" type="url" />
              <label htmlFor="sourceClass">Source class</label>
              <select id="sourceClass" name="sourceClass" defaultValue="OFFICIAL_SOURCE">
                <option value="OFFICIAL_SOURCE">Official source</option>
                <option value="WEB_CORROBORATED">Web corroborated</option>
                <option value="USER_PROVIDED">User provided</option>
                <option value="UNVERIFIED">Unverified</option>
                <option value="STALE_RISK">Stale risk</option>
                <option value="CONFLICT">Conflict</option>
              </select>
              <label htmlFor="sourceType">Source type</label>
              <input id="sourceType" name="sourceType" placeholder="press release, trailer, page" />
              <label htmlFor="factualAsOfDate">Factual as-of date</label>
              <input id="factualAsOfDate" name="factualAsOfDate" type="date" />
              <label htmlFor="supportNotes">Support notes / excerpt</label>
              <textarea id="supportNotes" name="supportNotes" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Register source</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
