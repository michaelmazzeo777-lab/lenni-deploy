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
  approveRenderVersionAction,
  publishShortAction,
} from "@/app/studio/shorts-actions";
import { cancelPremiumRenderAction, startPremiumRenderAction } from "@/app/studio/premium-actions";
import { AutoRefresh } from "@/app/studio/_auto-refresh";
import { recoverInterruptedJobs } from "@/domain/premiumRender";
import { engineProblems } from "@/lib/premium/engine";

interface QaView {
  verified?: boolean;
  checks?: { name: string; status: string; detail: string }[];
  measurements?: { loudness?: { integratedLufs: number; truePeakDb: number }; wer?: number | null };
  humanValidation?: string[];
}
const MEDIA_CLASS: Record<string, string> = {
  ENGINEERING_FIXTURE: "ENGINEERING FIXTURE",
  ILLUSTRATIVE_DRAFT: "ILLUSTRATIVE DRAFT — not gameplay",
  GAMEPLAY_CAPTURE: "GAMEPLAY CAPTURE",
};
const REVIEW_STATE: Record<string, string> = {
  PENDING_MIKE_REVIEW: "PENDING MIKE REVIEW",
  MIKE_APPROVED: "MIKE APPROVED",
  REJECTED: "REJECTED",
};

export const metadata = { title: "Shorts pipeline — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function ShortsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;
  // A premium job whose process died with the Studio is closed here so it can be retried.
  await recoverInterruptedJobs(actor.workspaceId);

  const [captures, scripts, failedJobs, premiumJobs] = await Promise.all([
    prisma.captureSession.findMany({
      where: {
        content: { workspaceId: actor.workspaceId },
        targetsShorts: true,
        // Gameplay captures must be approved; an explainer session has no footage to review.
        OR: [{ status: "APPROVED" }, { kind: "GRAPHICS" }],
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
    prisma.mediaJob.findMany({
      where: { workspaceId: actor.workspaceId, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.mediaJob.findMany({
      where: { workspaceId: actor.workspaceId, kind: "PREMIUM_RENDER" },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  const premiumJob = (voiceoverId: string) => premiumJobs.find((j) => j.subjectId === voiceoverId);
  const premiumNotReady = engineProblems();
  // The latest failure per narration (script) or render (voiceover + format).
  const failed = (subjectId: string, label: string) =>
    failedJobs.find((j) => j.subjectId === subjectId && j.label === label);

  const mayGenerate = can(actor, "ai.generate");
  const mayApprove = can(actor, "shorts.approve");
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
      <AutoRefresh active={premiumJobs.some((j) => j.status === "RUNNING")} />

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
                    {c.kind === "GRAPHICS" ? (
                      c.shortsScripts.some((sc) => sc.status === "VALID") ? (
                        <span className="muted">Explainer scripted.</span>
                      ) : mayGenerate && scriptP !== "mock" ? (
                        <details>
                          <summary>Write explainer script (title cards)</summary>
                          <form action={draftShortsScriptAction}>
                            <input type="hidden" name="captureSessionId" value={c.id} />
                            <p className="muted" style={{ fontSize: "0.78rem" }}>
                              Each line is what the narrator says, then its title card:{" "}
                              <code>spoken sentence || LABEL :: STATEMENT :: note</code>. Write
                              words as they should be spoken.
                            </p>
                            <label htmlFor={`xhook-${c.id}`}>Hook (with its card)</label>
                            <input id={`xhook-${c.id}`} name="hookText" required />
                            <label htmlFor={`xlines-${c.id}`}>
                              Explainer lines (one per line, each with its card)
                            </label>
                            <textarea id={`xlines-${c.id}`} name="lines" rows={6} required />
                            <div style={{ marginTop: 8 }}>
                              <button type="submit" className="secondary">
                                Save explainer script ({scriptP})
                              </button>
                            </div>
                          </form>
                        </details>
                      ) : (
                        <span className="muted">Needs the local pipeline.</span>
                      )
                    ) : mayGenerate && scriptP !== "mock" ? (
                      // A cut that already has a script is not offered again.
                      c.highlights.filter(
                        (h) => !c.shortsScripts.some((sc) => sc.highlightCandidateId === h.id),
                      ).length === 0 ? (
                        c.highlights.length > 0 ? (
                          <span className="muted">All approved cuts are scripted.</span>
                        ) : (
                          <span className="muted">
                            Approve a highlight cut in Capture intake first.
                          </span>
                        )
                      ) : c.highlights.length === 0 ? (
                        <span className="muted">
                          Approve a highlight cut in Capture intake first.
                        </span>
                      ) : (
                        c.highlights
                          .filter(
                            (h) => !c.shortsScripts.some((sc) => sc.highlightCandidateId === h.id),
                          )
                          .map((h) => (
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

          {!script.voiceover && failed(script.id, "Narration") ? (
            <p className="error" role="alert" style={{ fontSize: "0.82rem" }}>
              Narration failed (attempt {failed(script.id, "Narration")!.attempts}):{" "}
              {failed(script.id, "Narration")!.lastError}
            </p>
          ) : null}
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
                {failed(script.id, "Narration") ? "Retry voiceover" : "Synthesize voiceover"} (
                {ttsP})
              </button>
            </form>
          ) : null}

          {script.voiceover ? (
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Voiceover: {script.voiceover.assetPath} ({script.voiceover.durationSec}s)
              {script.voiceover.voiceName
                ? ` · ${script.voiceover.voiceName}${script.voiceover.isSynthetic ? " (synthetic)" : ""}`
                : ""}
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
                      {failed(script.voiceover!.id, `Render ${format}`)
                        ? "Retry render"
                        : script.renders.some((r) => r.format === format)
                          ? "Re-render"
                          : "Render"}
                      {local ? ` ${format}` : ""} ({videoP})
                    </button>
                  </form>
                ) : null,
              )}
            </div>
          ) : null}
          {script.voiceover
            ? ["9:16", "16:9"]
                .map((format) => ({
                  format,
                  job: failed(script.voiceover!.id, `Render ${format}`),
                }))
                .filter(
                  (x) =>
                    x.job &&
                    !script.renders.some((r) => r.format === x.format && r.status !== "REJECTED"),
                )
                .map((x) => (
                  <p key={x.format} className="error" role="alert" style={{ fontSize: "0.82rem" }}>
                    Render {x.format} failed (attempt {x.job!.attempts}): {x.job!.lastError}
                  </p>
                ))
            : null}

          {script.voiceover && script.captureSession.kind === "GRAPHICS"
            ? (() => {
                const job = premiumJob(script.voiceover.id);
                const has = script.renders.some(
                  (r) =>
                    r.status !== "REJECTED" &&
                    (r.manifestJson as { renderer?: string } | null)?.renderer === "premium-engine",
                );
                const running = job?.status === "RUNNING";
                return (
                  <div
                    data-testid="premium-panel"
                    style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}
                  >
                    <strong>Premium render</strong>{" "}
                    <span className="muted" style={{ fontSize: "0.82rem" }}>
                      16:9 and native 9:16 together, with moving artwork, timed captions and
                      levelled sound. Takes a few minutes; you can leave this page.
                    </span>
                    {job ? (
                      <p style={{ margin: "6px 0" }}>
                        <span
                          className={`badge ${
                            job.status === "SUCCEEDED"
                              ? "CONFIRMED"
                              : job.status === "FAILED"
                                ? "LEAKED"
                                : "UNVERIFIED"
                          }`}
                        >
                          {job.status}
                        </span>{" "}
                        <span style={{ fontSize: "0.85rem" }}>
                          {running
                            ? (job.progress ?? "Working")
                            : job.status === "SUCCEEDED"
                              ? "Finished. Both files are listed below and in the Library."
                              : (job.lastError ?? "")}
                        </span>{" "}
                        <span className="muted" style={{ fontSize: "0.78rem" }}>
                          attempt {job.attempts}
                          {job.startedAt
                            ? ` · started ${job.startedAt.toISOString().slice(11, 19)} UTC`
                            : ""}
                        </span>
                      </p>
                    ) : null}
                    {premiumNotReady.length > 0 ? (
                      <p className="error" style={{ fontSize: "0.82rem" }}>
                        Premium engine not ready: {premiumNotReady.join("; ")}
                      </p>
                    ) : null}
                    {mayGenerate && running ? (
                      <form action={cancelPremiumRenderAction} style={{ display: "inline" }}>
                        <input type="hidden" name="jobId" value={job!.id} />
                        <button type="submit" className="secondary">
                          Cancel premium render
                        </button>
                      </form>
                    ) : null}
                    {mayGenerate && !running && !has && premiumNotReady.length === 0 ? (
                      <form action={startPremiumRenderAction} style={{ display: "inline" }}>
                        <input type="hidden" name="voiceoverId" value={script.voiceover.id} />
                        <button type="submit">
                          {job && job.status !== "SUCCEEDED"
                            ? "Retry premium render"
                            : "Start premium render"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })()
            : null}

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
                Render {r.resolution} @{r.frameRate}fps
                {(r.manifestJson as { renderer?: string } | null)?.renderer === "premium-engine"
                  ? " · PREMIUM"
                  : ""}{" "}
                ·{" "}
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
                {r.mediaClass === "ILLUSTRATIVE_DRAFT" ? (
                  <>
                    {" "}
                    <span className="badge UNVERIFIED">{MEDIA_CLASS[r.mediaClass]}</span>{" "}
                    <span className="badge LEAKED">never publishable</span>
                  </>
                ) : r.isFixture ? (
                  <>
                    {" "}
                    <span className="badge LEAKED">FIXTURE — never publishable</span>
                  </>
                ) : null}
                {r.reviewState ? (
                  <>
                    {" "}
                    <span
                      className={`badge ${
                        r.reviewState === "MIKE_APPROVED"
                          ? "CONFIRMED"
                          : r.reviewState === "REJECTED"
                            ? "LEAKED"
                            : "UNVERIFIED"
                      }`}
                    >
                      {REVIEW_STATE[r.reviewState] ?? r.reviewState}
                    </span>
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
                        Download review bundle (MP4, SRT, transcript, cover, manifest
                        {r.qaJson ? ", QA report, contact sheet" : ""})
                      </a>
                    </div>
                    {r.qaJson ? (
                      <div style={{ marginTop: 6 }}>
                        <div>
                          <strong>Automatic QA:</strong>{" "}
                          {(r.qaJson as QaView).verified
                            ? "all checks passed"
                            : "passed, with checks that could not be run"}{" "}
                          · <a href={`/studio/media/contact/${r.id}`}>contact sheet</a> ·{" "}
                          <a href={`/studio/media/qa/${r.id}`}>full report</a>
                        </div>
                        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                          {((r.qaJson as QaView).checks ?? []).map((c) => (
                            <li key={c.name}>
                              {c.status} — {c.name}: {c.detail}
                            </li>
                          ))}
                        </ul>
                        <div>
                          <strong>Still needs a person:</strong>{" "}
                          {((r.qaJson as QaView).humanValidation ?? []).join("; ")}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {r.reviewState === "PENDING_MIKE_REVIEW" && mayApprove ? (
                <form
                  action={approveRenderVersionAction}
                  className="row"
                  style={{ gap: 8, marginTop: 6 }}
                >
                  <input type="hidden" name="renderId" value={r.id} />
                  <label htmlFor={`sha-${r.id}`} style={{ margin: 0 }}>
                    Owner approval of this exact file — type the first 8 characters of its SHA-256
                  </label>
                  <input
                    id={`sha-${r.id}`}
                    name="checksumPrefix"
                    autoComplete="off"
                    pattern="[0-9a-fA-F]{8,64}"
                    required
                    style={{ width: 140 }}
                  />
                  <button type="submit">Approve this version</button>
                </form>
              ) : null}
              {r.reviewState === "MIKE_APPROVED" ? (
                <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                  Owner approved file <code>{r.approvedChecksum?.slice(0, 12)}…</code> on{" "}
                  {r.approvedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC. Approval is
                  internal; nothing here publishes.
                </p>
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

              {r.status === "CLEAN" &&
              !r.publication &&
              mayPublish &&
              !r.isFixture &&
              r.mediaClass !== "ILLUSTRATIVE_DRAFT" &&
              (!r.reviewState || r.reviewState === "MIKE_APPROVED") ? (
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
