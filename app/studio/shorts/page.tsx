import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import {
  draftShortsScriptAction,
  synthesizeVoiceoverAction,
  renderShortAction,
  reviewRenderAction,
  publishShortAction,
} from "@/app/studio/shorts-actions";

export const metadata = { title: "Shorts pipeline — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function ShortsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;

  const [captures, scripts] = await Promise.all([
    prisma.captureSession.findMany({
      where: {
        content: { workspaceId: actor.workspaceId },
        targetsShorts: true,
        status: "APPROVED",
      },
      include: { content: true, shortsScripts: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.shortsScript.findMany({
      where: { workspaceId: actor.workspaceId },
      include: {
        captureSession: { include: { content: true } },
        voiceover: true,
        renders: { include: { publication: true }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const mayGenerate = can(actor, "ai.generate");
  const mayReview = can(actor, "capture.review");
  const mayPublish = can(actor, "shorts.publish");

  return (
    <div>
      <h1>Shorts pipeline</h1>
      <p className="muted">
        Capture (approved, Shorts-flagged) → AI script draft → voiceover → render → human review →
        publish. All providers run in <strong>mock mode</strong> (deterministic, $0, no external
        calls) until real credentials are configured — a mock publish records a clearly-marked fake
        video ID and never reaches YouTube. Safety-flagged scripts are quarantined for human review,
        never auto-passed.
      </p>
      <Banner error={error} />

      <div className="card">
        <h2>Eligible captures ({captures.length})</h2>
        {captures.length === 0 ? (
          <p className="muted">
            None yet. Submit a capture with “Candidate for Shorts pipeline” checked, then have it
            approved in capture review.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Content</th>
                <th>File</th>
                <th>Platform</th>
                <th>Scripts</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {captures.map((c) => (
                <tr key={c.id}>
                  <td>{c.content.workingTitle}</td>
                  <td className="muted">{c.fileReference ?? "—"}</td>
                  <td className="muted">{c.platform}</td>
                  <td className="muted">{c.shortsScripts.length}</td>
                  <td>
                    {mayGenerate ? (
                      <form action={draftShortsScriptAction}>
                        <input type="hidden" name="captureSessionId" value={c.id} />
                        <button type="submit" className="secondary">
                          Draft script (mock)
                        </button>
                      </form>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scripts.map((script) => (
        <div className="card" key={script.id}>
          <h2>
            {script.captureSession.content.workingTitle}{" "}
            <span className={`badge ${script.status === "VALID" ? "CONFIRMED" : "LEAKED"}`}>
              {script.status}
            </span>
          </h2>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Hook: “{script.hookText}” · provider {script.provider} · model {script.model}
            {(script.safetyFlagsJson as unknown[]).length > 0
              ? ` · ${(script.safetyFlagsJson as unknown[]).length} safety flag(s) — human review required`
              : ""}
          </p>

          {script.status === "VALID" && !script.voiceover && mayGenerate ? (
            <form action={synthesizeVoiceoverAction} className="row" style={{ gap: 8 }}>
              <input type="hidden" name="scriptId" value={script.id} />
              <button type="submit" className="secondary">
                Synthesize voiceover (mock)
              </button>
            </form>
          ) : null}

          {script.voiceover ? (
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Voiceover: {script.voiceover.assetPath} ({script.voiceover.durationSec}s)
              {/* Re-rendering is allowed when every previous render was
                  rejected (the regenerate path); hidden only while a render
                  is pending review or already approved. */}
              {mayGenerate && !script.renders.some((r) => r.status !== "REJECTED") ? (
                <form action={renderShortAction} style={{ display: "inline", marginLeft: 8 }}>
                  <input type="hidden" name="voiceoverId" value={script.voiceover.id} />
                  <button type="submit" className="secondary">
                    {script.renders.length > 0 ? "Re-render (mock)" : "Render (mock)"}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {script.renders.map((r) => (
            <div
              key={r.id}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 10,
                marginTop: 10,
              }}
            >
              <p style={{ margin: 0 }}>
                Render {r.resolution} @{r.frameRate}fps ·{" "}
                <span
                  className={`badge ${
                    r.status === "CLEAN"
                      ? "CONFIRMED"
                      : r.status === "REJECTED"
                        ? "LEAKED"
                        : "UNVERIFIED"
                  }`}
                >
                  {r.status}
                </span>
                {r.publication?.status === "PUBLISHED" ? (
                  <>
                    {" "}
                    <span className="badge CONFIRMED">PUBLISHED</span>{" "}
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      video id: {r.publication.youtubeVideoId}
                    </span>
                  </>
                ) : null}
              </p>

              {r.status === "PENDING" && mayReview ? (
                <form action={reviewRenderAction} className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input type="hidden" name="renderId" value={r.id} />
                  <select name="decision" aria-label="Render decision">
                    <option value="APPROVED">Approve</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                  <input name="notes" placeholder="Notes (required to reject)" />
                  <button type="submit" className="secondary">
                    Record decision
                  </button>
                </form>
              ) : null}

              {r.status === "CLEAN" && !r.publication && mayPublish ? (
                <form action={publishShortAction} style={{ marginTop: 6 }}>
                  <input type="hidden" name="renderId" value={r.id} />
                  <label htmlFor={`title-${r.id}`}>Title</label>
                  <input id={`title-${r.id}`} name="title" required />
                  <label htmlFor={`desc-${r.id}`}>Description</label>
                  <textarea id={`desc-${r.id}`} name="description" rows={2} required />
                  <label htmlFor={`tags-${r.id}`}>Tags (comma-separated)</label>
                  <input id={`tags-${r.id}`} name="tags" placeholder="gta6, leonida" />
                  <div style={{ marginTop: 8 }}>
                    <button type="submit">Publish (mock — no real upload)</button>
                  </div>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
