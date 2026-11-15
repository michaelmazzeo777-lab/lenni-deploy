import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { AUDIO_EXT, listIngestFiles } from "@/lib/media/ingest";
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
      include: {
        content: true,
        shortsScripts: true,
        media: true,
        highlights: { where: { status: "APPROVED" }, orderBy: { rank: "asc" } },
      },
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

  // Provider names label every button, so the operator always sees whether a
  // step is the deterministic mock or the real local pipeline.
  const scriptP = process.env.SHORTS_SCRIPT_PROVIDER ?? "mock";
  const ttsP = process.env.TTS_PROVIDER ?? "mock";
  const videoP = process.env.VIDEO_COMPOSITOR_PROVIDER ?? "mock";
  const local = videoP !== "mock";
  const recordings = ttsP === "operator-recording" ? await listIngestFiles(AUDIO_EXT) : [];

  return (
    <div>
      <h1>Shorts pipeline</h1>
      <p className="muted">
        Capture (approved, Shorts-flagged) → AI script draft → voiceover → render → human review →
        publish.{" "}
        {local ? (
          <>
            Running the <strong>local pipeline</strong> (script: {scriptP}, narration: {ttsP},
            render: {videoP}) — real MP4s rendered on this machine, $0, no external calls. Renders
            from fixture footage or fixture narration are labeled and can never be published.
          </>
        ) : (
          <>
            All providers run in <strong>mock mode</strong> (deterministic, $0, no external calls)
            until real credentials are configured.
          </>
        )}{" "}
        A mock publish records a clearly-marked fake video ID and never reaches YouTube.
        Safety-flagged scripts are quarantined for human review, never auto-passed.
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
                    {mayGenerate && scriptP !== "mock" ? (
                      c.highlights.length === 0 ? (
                        <span className="muted">
                          Approve a highlight cut in Capture intake first.
                        </span>
                      ) : (
                        c.highlights.map((h) => (
                          <details key={h.id}>
                            <summary>
                              Write script for cut {h.rank} (
                              {(h.trimStartSec ?? h.startSec).toFixed(0)}
                              s–{(h.trimEndSec ?? h.endSec).toFixed(0)}s)
                            </summary>
                            <form action={draftShortsScriptAction}>
                              <input type="hidden" name="captureSessionId" value={c.id} />
                              <input type="hidden" name="highlightCandidateId" value={h.id} />
                              <label htmlFor={`hook-${h.id}`}>Hook</label>
                              <input id={`hook-${h.id}`} name="hookText" required />
                              <label htmlFor={`lines-${h.id}`}>Script lines (one per line)</label>
                              <textarea id={`lines-${h.id}`} name="lines" rows={3} required />
                              <div style={{ marginTop: 8 }}>
                                <button type="submit" className="secondary">
                                  Save script ({scriptP})
                                </button>
                              </div>
                            </form>
                          </details>
                        ))
                      )
                    ) : mayGenerate ? (
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
              {ttsP === "operator-recording" ? (
                <select name="voiceProfileId" aria-label="Narration recording" required>
                  {recordings.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              ) : null}
              <button type="submit" className="secondary">
                Synthesize voiceover ({ttsP})
              </button>
            </form>
          ) : null}

          {script.voiceover ? (
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Voiceover: {script.voiceover.assetPath} ({script.voiceover.durationSec}s)
              {/* Re-rendering is allowed when every previous render was
                  rejected (the regenerate path); hidden only while a render
                  is pending review or already approved. */}
              {(local ? ["9:16", "16:9"] : ["9:16"]).map((format) =>
                mayGenerate &&
                !script.renders.some((r) => r.format === format && r.status !== "REJECTED") ? (
                  <form
                    key={format}
                    action={renderShortAction}
                    style={{ display: "inline", marginLeft: 8 }}
                  >
                    <input type="hidden" name="voiceoverId" value={script.voiceover!.id} />
                    <input type="hidden" name="format" value={format} />
                    <button type="submit" className="secondary">
                      {script.renders.some((r) => r.format === format) ? "Re-render" : "Render"}
                      {local ? ` ${format}` : ""} ({videoP})
                    </button>
                  </form>
                ) : null,
              )}
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
                {r.isFixture ? (
                  <>
                    {" "}
                    <span className="badge LEAKED">FIXTURE — never publishable</span>
                  </>
                ) : null}
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

              {r.bundlePath && r.status !== "REJECTED" ? (
                <div className="row" style={{ gap: 16, alignItems: "flex-start", marginTop: 8 }}>
                  <video
                    controls
                    preload="metadata"
                    poster={`/studio/media/cover/${r.id}`}
                    style={{ width: r.format === "16:9" ? 360 : 200, background: "#000" }}
                    src={`/studio/media/render/${r.id}`}
                  />
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    <div>
                      {r.format} · {r.durationSec.toFixed(1)}s · real H.264/AAC MP4
                    </div>
                    <div>
                      SHA-256: <code>{r.checksumSha256}</code>
                    </div>
                    <div>
                      <a href={`/studio/media/bundle/${r.id}`}>
                        Download review bundle (MP4, SRT, transcript, cover, manifest)
                      </a>
                    </div>
                  </div>
                </div>
              ) : null}

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

              {r.status === "CLEAN" && !r.publication && mayPublish && !r.isFixture ? (
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
