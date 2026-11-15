import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner, humanStatus } from "@/app/_ui";
import { ingestDir, listIngestFiles, VIDEO_EXT } from "@/lib/media/ingest";
import {
  attachCaptureMediaAction,
  analyzeHighlightsAction,
  reviewHighlightAction,
} from "@/app/studio/captures-actions";

export const metadata = { title: "Capture intake — Field Guide Studio" };
export const dynamic = "force-dynamic";

const tc = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export default async function CapturesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;
  const maySubmit = can(actor, "capture.submit");
  const mayReview = can(actor, "capture.review");

  const [captures, files] = await Promise.all([
    prisma.captureSession.findMany({
      where: { content: { workspaceId: actor.workspaceId } },
      include: {
        content: true,
        media: true,
        highlights: { orderBy: [{ createdAt: "desc" }, { rank: "asc" }] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    listIngestFiles(VIDEO_EXT),
  ]);

  return (
    <div>
      <h1>Capture intake &amp; highlights</h1>
      <p className="muted">
        PS5: Create button → save recent gameplay → Media Gallery → copy to USB → copy the file into
        the ingest folder <code>{ingestDir()}</code>. Attach it to a capture session here (created
        on a content item&apos;s Production tab) to record provenance and a SHA-256. Highlight
        analysis ranks how exciting a window <em>looks and sounds</em> (motion, audio, cuts) — it is
        never evidence for a gameplay claim. Nothing leaves this machine.
      </p>
      <Banner error={error} />

      {captures.length === 0 ? <p className="muted">No capture sessions yet.</p> : null}

      {captures.map((c) => (
        <div className="card" key={c.id}>
          <h2>
            <Link href={`/studio/content/${c.contentId}?tab=production`}>
              {c.content.workingTitle}
            </Link>{" "}
            <span className="badge UNVERIFIED">{humanStatus(c.status)}</span>
            {c.media?.rightsStatus === "INTERNAL_FIXTURE" ? (
              <span className="badge LEAKED">FIXTURE — not gameplay</span>
            ) : null}
          </h2>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            {c.platform} · {c.gameVersion} · captured {c.captureDate.toISOString().slice(0, 10)} ·
            HUD {c.hudVisible ? "on" : "off"} · spoiler {c.spoilerLevel}
            {c.containsLicensedMusic ? " · licensed music (blocked from Shorts)" : ""}
          </p>

          {c.media ? (
            <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
              <video
                controls
                preload="metadata"
                style={{ width: 320, background: "#000" }}
                src={`/studio/media/capture/${c.id}`}
              />
              <div className="muted" style={{ fontSize: "0.82rem" }}>
                <div>
                  File: {c.media.originalName} · {c.media.width}x{c.media.height} @
                  {c.media.frameRate}fps · {tc(c.media.durationSec)} ·{" "}
                  {(Number(c.media.sizeBytes) / 1e6).toFixed(1)} MB
                </div>
                <div>
                  Operator: {c.media.operator} · {humanStatus(c.media.captureMethod)} ·{" "}
                  {c.media.sourceDevice}
                  {c.media.gameMode ? ` · ${c.media.gameMode}` : ""}
                </div>
                <div>Rights: {humanStatus(c.media.rightsStatus)}</div>
                <div>
                  SHA-256: <code>{c.media.checksumSha256}</code>
                </div>
                {mayReview && c.status === "APPROVED" ? (
                  <form action={analyzeHighlightsAction} style={{ marginTop: 8 }}>
                    <input type="hidden" name="captureSessionId" value={c.id} />
                    <button type="submit" className="secondary">
                      {c.highlights.length > 0 ? "Re-analyze highlights" : "Analyze highlights"}
                    </button>
                  </form>
                ) : (
                  <div>Approve the capture (Production tab) before analysis.</div>
                )}
              </div>
            </div>
          ) : maySubmit && !c.flagLeaked && c.status !== "BLOCKED" ? (
            <details>
              <summary>Attach video from ingest folder ({files.length} file(s) found)</summary>
              <form action={attachCaptureMediaAction}>
                <input type="hidden" name="captureSessionId" value={c.id} />
                <label htmlFor={`file-${c.id}`}>Video file</label>
                <select id={`file-${c.id}`} name="fileName" required>
                  {files.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <label htmlFor={`op-${c.id}`}>Operator (who captured it)</label>
                <input
                  id={`op-${c.id}`}
                  name="operator"
                  defaultValue={actor.displayName}
                  required
                />
                <label htmlFor={`method-${c.id}`}>Capture method</label>
                <select id={`method-${c.id}`} name="captureMethod">
                  <option value="PS5_NATIVE_USB">PS5 native recording → USB</option>
                  <option value="CAPTURE_CARD_OBS">Capture card → OBS</option>
                  <option value="SYNTHETIC_FIXTURE">Synthetic test fixture</option>
                  <option value="OTHER">Other</option>
                </select>
                <label htmlFor={`rights-${c.id}`}>Rights status</label>
                <select id={`rights-${c.id}`} name="rightsStatus">
                  <option value="OWNED_ORIGINAL_CAPTURE">Owned original capture</option>
                  <option value="INTERNAL_FIXTURE">Internal fixture (never publishable)</option>
                  <option value="UNCLEARED">Uncleared (blocked from use)</option>
                </select>
                <label htmlFor={`dev-${c.id}`}>Source device</label>
                <input
                  id={`dev-${c.id}`}
                  name="sourceDevice"
                  defaultValue="PlayStation 5"
                  required
                />
                <label htmlFor={`mode-${c.id}`}>Game mode</label>
                <input id={`mode-${c.id}`} name="gameMode" placeholder="Story / Online" />
                <label htmlFor={`audio-${c.id}`}>Audio notes (chat, muted music…)</label>
                <input id={`audio-${c.id}`} name="audioNotes" />
                <div style={{ marginTop: 12 }}>
                  <button type="submit">Ingest &amp; attach</button>
                </div>
              </form>
            </details>
          ) : (
            <p className="muted">No media attached.</p>
          )}

          {c.highlights.length > 0 ? (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Frame</th>
                  <th>In – out</th>
                  <th>Score</th>
                  <th>Why it ranked</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {c.highlights.map((h) => {
                  const inSec = h.trimStartSec ?? h.startSec;
                  const outSec = h.trimEndSec ?? h.endSec;
                  const sig = h.signalsJson as { reasons?: string[] };
                  return (
                    <tr key={h.id}>
                      <td>{h.rank}</td>
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/studio/media/thumb/${h.id}`}
                          alt={`Frame at ${tc(h.peakSec)}`}
                          width={120}
                        />
                      </td>
                      <td>
                        <a
                          href={`/studio/media/capture/${c.id}#t=${inSec},${outSec}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {tc(inSec)} – {tc(outSec)}
                        </a>
                        <div className="muted" style={{ fontSize: "0.75rem" }}>
                          {(outSec - inSec).toFixed(0)}s
                          {h.trimStartSec !== null ? " · trimmed" : ""}
                        </div>
                      </td>
                      <td>{h.score.toFixed(2)}</td>
                      <td className="muted" style={{ fontSize: "0.78rem" }}>
                        {(sig.reasons ?? []).join("; ")}
                      </td>
                      <td>
                        {humanStatus(h.status)}
                        {h.reviewNotes ? (
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            {h.reviewNotes}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {mayReview ? (
                          <form action={reviewHighlightAction} className="row" style={{ gap: 4 }}>
                            <input type="hidden" name="candidateId" value={h.id} />
                            <select
                              name="decision"
                              aria-label={`Decision for cut ${h.rank}`}
                              defaultValue={h.status === "REJECTED" ? "REJECTED" : "APPROVED"}
                            >
                              <option value="APPROVED">Approve</option>
                              <option value="REJECTED">Reject</option>
                            </select>
                            <input
                              name="trimStartSec"
                              type="number"
                              step="0.1"
                              min={0}
                              aria-label={`Trim in for cut ${h.rank} (seconds)`}
                              defaultValue={inSec}
                              style={{ width: 70 }}
                            />
                            <input
                              name="trimEndSec"
                              type="number"
                              step="0.1"
                              min={0}
                              aria-label={`Trim out for cut ${h.rank} (seconds)`}
                              defaultValue={outSec}
                              style={{ width: 70 }}
                            />
                            <input name="notes" placeholder="Notes" style={{ width: 100 }} />
                            <button type="submit" className="secondary">
                              Save cut {h.rank}
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      ))}
    </div>
  );
}
