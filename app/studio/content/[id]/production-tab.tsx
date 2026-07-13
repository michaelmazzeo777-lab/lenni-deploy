import Link from "next/link";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { humanStatus } from "@/app/_ui";
import {
  createShotAction,
  submitCaptureAction,
  reviewCaptureAction,
} from "@/app/studio/production-actions";

export async function ProductionTab({ actor, contentId }: { actor: Actor; contentId: string }) {
  const [shots, captures, assignments] = await Promise.all([
    prisma.shot.findMany({ where: { contentId }, orderBy: { order: "asc" } }),
    prisma.captureSession.findMany({ where: { contentId }, orderBy: { createdAt: "desc" } }),
    prisma.assignment.findMany({
      where: { contentId, kind: "GAMEPLAY_CAPTURE" },
      include: { contributor: true },
    }),
  ]);
  const mayEdit = can(actor, "content.edit");
  const maySubmit = can(actor, "capture.submit");
  const mayReview = can(actor, "capture.review");
  const mayExport = can(actor, "handoff.export");

  return (
    <div>
      {mayExport ? (
        <p>
          <Link href={`/studio/handoff/${contentId}`} className="btn secondary">
            Download handoff (Markdown)
          </Link>{" "}
          <Link href={`/studio/handoff/${contentId}?format=json`} className="btn secondary">
            Download handoff (JSON)
          </Link>
        </p>
      ) : null}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "1 1 340px" }}>
          <h2>Shot list ({shots.length})</h2>
          <ol>
            {shots.map((sh) => (
              <li key={sh.id}>
                <strong>{sh.title}</strong>
                {sh.description ? <span className="muted"> — {sh.description}</span> : null}
              </li>
            ))}
            {shots.length === 0 ? <li className="muted">No shots planned.</li> : null}
          </ol>
          {mayEdit ? (
            <form action={createShotAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="contentId" value={contentId} />
              <label htmlFor="order">Order</label>
              <input
                id="order"
                name="order"
                type="number"
                min={1}
                defaultValue={shots.length + 1}
              />
              <label htmlFor="shot-title">Shot title</label>
              <input id="shot-title" name="title" required />
              <label htmlFor="description">Description</label>
              <input id="description" name="description" />
              <label htmlFor="captureNotes">Capture notes</label>
              <input id="captureNotes" name="captureNotes" />
              <div style={{ marginTop: 12 }}>
                <button type="submit">Add shot</button>
              </div>
            </form>
          ) : null}
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 12 }}>
            Gameplay assignments:{" "}
            {assignments
              .map((a) => `${a.contributor.displayName} (${humanStatus(a.status)})`)
              .join(", ") || "none — assign in Contributors"}
          </p>
        </div>

        <div className="card" style={{ flex: "2 1 420px" }}>
          <h2>Capture sessions ({captures.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Platform / version</th>
                <th>Flags</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {captures.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.platform} · {c.gameVersion}
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      {c.fileReference ?? "no file ref"}
                      {c.supersedesId ? " · replaces earlier take" : ""}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: "0.78rem" }}>
                    {c.flagLeaked ? <span className="badge LEAKED">leaked</span> : null}
                    {c.containsLicensedMusic ? " licensed-music" : ""}
                    {c.modsDeclared ? " mods" : ""}
                    {!c.hudVisible ? " no-HUD" : ""}
                  </td>
                  <td>
                    {humanStatus(c.status)}
                    {c.reviewNotes ? (
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        {c.reviewNotes}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {mayReview && ["SUBMITTED", "RETAKE_REQUESTED"].includes(c.status) ? (
                      <form action={reviewCaptureAction} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="contentId" value={contentId} />
                        <input type="hidden" name="captureId" value={c.id} />
                        <select name="decision" defaultValue="APPROVED" style={{ width: 140 }}>
                          <option value="APPROVED">Approve</option>
                          <option value="RETAKE_REQUESTED">Request retake</option>
                          <option value="REJECTED">Reject</option>
                          <option value="BLOCKED">Block</option>
                        </select>
                        <input name="reviewNotes" placeholder="Notes" style={{ width: 120 }} />
                        <button type="submit" className="secondary">
                          Review
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {captures.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No capture sessions.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {maySubmit ? (
            <details style={{ marginTop: 12 }}>
              <summary>Submit capture footage (metadata only)</summary>
              <form action={submitCaptureAction}>
                <input type="hidden" name="contentId" value={contentId} />
                <label htmlFor="platform">Platform</label>
                <input id="platform" name="platform" placeholder="PlayStation 5" required />
                <label htmlFor="gameVersion">Game version / patch</label>
                <input id="gameVersion" name="gameVersion" placeholder="1.0" required />
                <label htmlFor="shotId">Shot</label>
                <select id="shotId" name="shotId">
                  <option value="">—</option>
                  {shots.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      #{sh.order} {sh.title}
                    </option>
                  ))}
                </select>
                <label htmlFor="assignmentId">Assignment</label>
                <select id="assignmentId" name="assignmentId">
                  <option value="">—</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.contributor.displayName}
                    </option>
                  ))}
                </select>
                <label htmlFor="fileReference">File reference</label>
                <input id="fileReference" name="fileReference" placeholder="capture-001.mp4" />
                <label htmlFor="trialCount">Trial count</label>
                <input id="trialCount" name="trialCount" type="number" min={1} />
                {[
                  ["hudVisible", "HUD visible", true],
                  ["containsLicensedMusic", "Contains licensed music", false],
                  ["modsDeclared", "Mods/cheats used (declared)", false],
                  ["flagLeaked", "Leaked/prerelease material (auto-blocks)", false],
                ].map(([name, label, checked]) => (
                  <label key={String(name)} style={{ display: "flex", gap: 8 }}>
                    <input
                      type="checkbox"
                      name={String(name)}
                      style={{ width: "auto" }}
                      defaultChecked={Boolean(checked)}
                    />{" "}
                    {label}
                  </label>
                ))}
                <div style={{ marginTop: 12 }}>
                  <button type="submit">Submit capture</button>
                </div>
              </form>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
