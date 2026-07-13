import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { listAssignmentsFor, isRestrictedContributor } from "@/domain/contributors";
import { Banner, humanStatus } from "@/app/_ui";
import {
  createContributorAction,
  createAssignmentAction,
  submitAssignmentAction,
  reviewAssignmentAction,
  recordReleaseAction,
} from "@/app/studio/production-actions";
import { AssignmentKind } from "@prisma/client";

export const metadata = { title: "Contributors — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function ContributorsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { error } = await searchParams;
  const restricted = isRestrictedContributor(actor);
  const mayManage = can(actor, "contributor.manage");

  const assignments = await listAssignmentsFor(actor);
  const [contributors, contentItems] = mayManage
    ? await Promise.all([
        prisma.contributor.findMany({
          where: { workspaceId: actor.workspaceId },
          orderBy: { displayName: "asc" },
        }),
        prisma.contentItem.findMany({
          where: { workspaceId: actor.workspaceId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
        }),
      ])
    : [[], []];

  return (
    <div>
      <h1>Contributors &amp; assignments</h1>
      <p className="muted">
        {restricted
          ? "You see only your own assignments."
          : "Contractor profiles hold no payment or identity data — names and specialties only."}
      </p>
      <Banner error={error} />

      <div className="card">
        <h2>Assignments ({assignments.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Content</th>
              <th>Kind</th>
              <th>Contributor</th>
              <th>Status</th>
              <th>Release</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.content.workingTitle.slice(0, 40)}</td>
                <td className="muted">{humanStatus(a.kind)}</td>
                <td>{a.contributor.displayName}</td>
                <td>
                  {humanStatus(a.status)}
                  {a.reviewNotes ? (
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      {a.reviewNotes}
                    </div>
                  ) : null}
                </td>
                <td>
                  {a.rightsReleaseStatus === "RECEIVED" ? (
                    <span className="badge CONFIRMED">received</span>
                  ) : a.rightsReleaseStatus === "PENDING" ? (
                    <span className="badge RUMOR">pending</span>
                  ) : (
                    <span className="muted">n/a</span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {["ASSIGNED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(a.status) ? (
                      <form action={submitAssignmentAction} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <input
                          name="deliverableNotes"
                          placeholder="Deliverable notes"
                          style={{ width: 150 }}
                          required
                        />
                        <button type="submit" className="secondary">
                          Submit
                        </button>
                      </form>
                    ) : null}
                    {mayManage && a.status === "SUBMITTED" ? (
                      <form action={reviewAssignmentAction} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <select name="decision" defaultValue="APPROVED" style={{ width: 150 }}>
                          <option value="APPROVED">Approve</option>
                          <option value="REVISION_REQUESTED">Request revision</option>
                          <option value="REJECTED">Reject</option>
                        </select>
                        <input name="reviewNotes" placeholder="Notes" style={{ width: 120 }} />
                        <button type="submit" className="secondary">
                          Review
                        </button>
                      </form>
                    ) : null}
                    {mayManage && a.rightsReleaseStatus === "PENDING" ? (
                      <form action={recordReleaseAction}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button type="submit" className="secondary">
                          Record release
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {assignments.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No assignments.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {mayManage ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>Contributor profiles ({contributors.length})</h2>
            <ul>
              {contributors.map((c) => (
                <li key={c.id}>
                  <strong>{c.displayName}</strong>{" "}
                  <span className="muted">
                    {c.specialty ?? ""} · {c.status}
                    {c.userId ? " · has sign-in" : ""}
                  </span>
                </li>
              ))}
              {contributors.length === 0 ? <li className="muted">None</li> : null}
            </ul>
            <form action={createContributorAction} style={{ marginTop: 12 }}>
              <label htmlFor="displayName">Name</label>
              <input id="displayName" name="displayName" required />
              <label htmlFor="specialty">Specialty</label>
              <input id="specialty" name="specialty" placeholder="Gameplay capture, narration…" />
              <label htmlFor="userId">Linked user ID (optional)</label>
              <input id="userId" name="userId" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Add contributor</button>
              </div>
            </form>
          </div>

          <div className="card" style={{ flex: "1 1 320px" }}>
            <h2>New assignment</h2>
            <form action={createAssignmentAction}>
              <label htmlFor="contentId">Content</label>
              <select id="contentId" name="contentId" required>
                {contentItems.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.workingTitle.slice(0, 50)}
                  </option>
                ))}
              </select>
              <label htmlFor="contributorId">Contributor</label>
              <select id="contributorId" name="contributorId" required>
                {contributors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
              <label htmlFor="kind">Kind</label>
              <select id="kind" name="kind" defaultValue="GAMEPLAY_CAPTURE">
                {Object.values(AssignmentKind).map((k) => (
                  <option key={k} value={k}>
                    {humanStatus(k)}
                  </option>
                ))}
              </select>
              <label htmlFor="dueAt">Due date</label>
              <input id="dueAt" name="dueAt" type="date" />
              <label htmlFor="deliverableNotes">Deliverables</label>
              <textarea id="deliverableNotes" name="deliverableNotes" />
              <label style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input type="checkbox" name="releaseNotRequired" style={{ width: "auto" }} /> No
                rights release needed
              </label>
              <div style={{ marginTop: 12 }}>
                <button type="submit">Assign</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
