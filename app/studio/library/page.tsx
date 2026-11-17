import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { approveRenderVersionAction, reviewRenderAction } from "@/app/studio/shorts-actions";
import { approveSessionClipAction, reviewSessionClipAction } from "@/app/studio/clipper-actions";
import { externalClearance } from "@/lib/rights/clearance";

// LIBRARY and REVIEW: every rendered video that still exists, playable, with
// what a reviewer needs beside it - evidence, asset rights, QA, approval state.

export const metadata = { title: "Library & review — Field Guide Studio" };
export const dynamic = "force-dynamic";

interface Manifest {
  renderer?: string;
  burnedLabel?: string | null;
  publication?: string;
  evidence?: {
    statement: string;
    classification: string;
    status: string;
    sources: { title: string; publisher: string; url: string | null }[];
  }[];
  assets?: { file: string; role: string; origin: string; rights: string }[];
  narration?: {
    voiceName?: string | null;
    isSynthetic?: boolean;
    voiceLicenseNote?: string | null;
  };
  source?: { originalName?: string; rightsStatus?: string; captureMethod?: string; kind?: string };
}
interface Qa {
  verified?: boolean;
  checks?: { name: string; status: string; detail: string }[];
  humanValidation?: string[];
}
const STATE: Record<string, string> = {
  PENDING_MIKE_REVIEW: "PENDING MIKE REVIEW",
  MIKE_APPROVED: "MIKE APPROVED (internal)",
  REJECTED: "REVISION REQUESTED",
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;
  const renders = await prisma.shortsRender.findMany({
    where: { workspaceId: actor.workspaceId, bundlePath: { not: null } },
    include: {
      script: {
        include: {
          captureSession: {
            include: {
              content: {
                include: {
                  claims: {
                    include: { claim: { include: { sources: { include: { source: true } } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const sessionClips = await prisma.sessionClip.findMany({
    where: { workspaceId: actor.workspaceId, bundlePath: { not: null } },
    include: {
      captureSession: { include: { content: true, media: { include: { agreement: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const mayApprove = can(actor, "shorts.approve");
  const mayReview = can(actor, "capture.review");

  return (
    <div>
      <h1>Library &amp; review</h1>
      <p className="muted">
        Every rendered video, newest first. Play it here, check its evidence, asset rights and QA,
        then approve it internally or ask for a revision. Approval is internal only:{" "}
        <strong>nothing on this page publishes.</strong>
      </p>
      <Banner error={error} />
      {renders.length === 0 ? (
        <div className="card">
          <p className="muted">
            Nothing rendered yet. Make a video in the{" "}
            <Link href="/studio/shorts">Shorts pipeline</Link>.
          </p>
        </div>
      ) : null}
      {renders.map((r) => {
        const m = (r.manifestJson ?? {}) as Manifest;
        const qa = (r.qaJson ?? null) as Qa | null;
        const content = r.script.captureSession.content;
        const claims = content.claims.map((l) => l.claim);
        const gone = r.status === "REJECTED";
        return (
          <div className="card" key={r.id} data-testid="library-item">
            <h2 style={{ marginBottom: 4 }}>{content.workingTitle}</h2>
            <p style={{ margin: 0 }}>
              {r.format} · {r.resolution} · {r.durationSec.toFixed(1)}s ·{" "}
              {m.renderer === "premium-engine" ? "premium render" : "standard render"}{" "}
              <span
                className={`badge ${r.reviewState === "MIKE_APPROVED" ? "CONFIRMED" : gone ? "LEAKED" : "UNVERIFIED"}`}
              >
                {STATE[r.reviewState ?? ""] ?? r.status}
              </span>{" "}
              {r.mediaClass === "ILLUSTRATIVE_DRAFT" ? (
                <span className="badge RUMOR">ILLUSTRATIVE — not gameplay</span>
              ) : null}{" "}
              {r.mediaClass === "ENGINEERING_FIXTURE" ? (
                <span className="badge RUMOR">FIXTURE — not gameplay</span>
              ) : null}{" "}
              <span className="badge LEAKED">PUBLICATION BLOCKED</span>
            </p>
            {gone ? (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Revision requested{r.reviewNotes ? `: ${r.reviewNotes}` : ""}. The file is no longer
                served. Render it again from the <Link href="/studio/shorts">Shorts pipeline</Link>.
              </p>
            ) : (
              <div
                className="row"
                style={{ gap: 16, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}
              >
                <div>
                  <video
                    controls
                    preload="metadata"
                    poster={`/studio/media/cover/${r.id}`}
                    style={{ width: r.format === "16:9" ? 420 : 220, background: "#000" }}
                    src={`/studio/media/render/${r.id}`}
                  />
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    Captions are burned into the picture.{" "}
                    <a href={`/studio/media/captions/${r.id}`}>Caption file (SRT)</a> ·{" "}
                    <a href={`/studio/media/contact/${r.id}`}>contact sheet</a> ·{" "}
                    <a href={`/studio/media/bundle/${r.id}`}>review bundle</a>
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    SHA-256: <code>{r.checksumSha256}</code>
                  </div>
                </div>
                <div style={{ fontSize: "0.82rem", flex: 1, minWidth: 320 }}>
                  <details open>
                    <summary>
                      <strong>Evidence</strong> ({claims.length} linked claim
                      {claims.length === 1 ? "" : "s"})
                    </summary>
                    {claims.length === 0 ? (
                      <p className="muted">No claims are linked to this content.</p>
                    ) : null}
                    <ul style={{ margin: "4px 0 8px 18px" }}>
                      {claims.map((c) => (
                        <li key={c.id}>
                          [{c.classification} · {c.status}] {c.statement}
                          <br />
                          <span className="muted">
                            {c.sources.length === 0
                              ? "no source recorded"
                              : c.sources
                                  .map(
                                    (s) =>
                                      `${s.source.publisher}: ${s.source.title}${s.source.url ? ` (${s.source.url})` : ""}`,
                                  )
                                  .join("; ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link href={`/studio/content/${content.id}?tab=evidence`}>
                      Open the evidence tab
                    </Link>
                  </details>
                  <details open>
                    <summary>
                      <strong>Asset rights</strong>
                    </summary>
                    <ul style={{ margin: "4px 0 8px 18px" }}>
                      {(m.assets ?? []).map((a) => (
                        <li key={a.file}>
                          {a.role}: {a.file} — {a.rights}
                        </li>
                      ))}
                      {m.source?.originalName ? (
                        <li>
                          footage: {m.source.originalName} — rights {m.source.rightsStatus}; capture
                          method {m.source.captureMethod}
                        </li>
                      ) : null}
                      {m.narration ? (
                        <li>
                          voice: {m.narration.voiceName ?? "unnamed"}
                          {m.narration.isSynthetic ? " (synthetic)" : ""} —{" "}
                          {m.narration.voiceLicenseNote ?? "licence not recorded"}
                        </li>
                      ) : null}
                      {m.burnedLabel ? <li>on-screen label: {m.burnedLabel}</li> : null}
                    </ul>
                  </details>
                  <details open>
                    <summary>
                      <strong>Automatic QA</strong>:{" "}
                      {qa
                        ? (qa.checks ?? []).some((c) => c.status === "FAIL")
                          ? "a check failed"
                          : "all checks passed"
                        : "not recorded"}
                    </summary>
                    <ul style={{ margin: "4px 0 8px 18px" }}>
                      {(qa?.checks ?? []).map((c) => (
                        <li key={c.name}>
                          {c.status} — {c.name}: {c.detail}
                        </li>
                      ))}
                    </ul>
                    {qa?.humanValidation?.length ? (
                      <p>Still needs a person: {qa.humanValidation.join("; ")}</p>
                    ) : null}
                  </details>
                </div>
              </div>
            )}
            {!gone && r.reviewState === "PENDING_MIKE_REVIEW" && mayApprove ? (
              <form
                action={approveRenderVersionAction}
                className="row"
                style={{ gap: 8, marginTop: 8 }}
              >
                <input type="hidden" name="renderId" value={r.id} />
                <input type="hidden" name="back" value="/studio/library" />
                <label htmlFor={`lib-sha-${r.id}`} style={{ margin: 0 }}>
                  Owner approval of this exact file — type the first 8 characters of its SHA-256
                </label>
                <input
                  id={`lib-sha-${r.id}`}
                  name="checksumPrefix"
                  autoComplete="off"
                  pattern="[0-9a-fA-F]{8,64}"
                  required
                  style={{ width: 140 }}
                />
                <button type="submit">Approve internally</button>
              </form>
            ) : null}
            {r.reviewState === "MIKE_APPROVED" ? (
              <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                Owner approved file <code>{r.approvedChecksum?.slice(0, 12)}…</code>. Approval is
                internal; nothing here publishes.
              </p>
            ) : null}
            {!gone && r.status === "PENDING" && mayReview ? (
              <form action={reviewRenderAction} className="row" style={{ gap: 8, marginTop: 8 }}>
                <input type="hidden" name="renderId" value={r.id} />
                <input type="hidden" name="back" value="/studio/library" />
                <input type="hidden" name="decision" value="REJECTED" />
                <label htmlFor={`lib-notes-${r.id}`} style={{ margin: 0 }}>
                  What needs to change
                </label>
                <input id={`lib-notes-${r.id}`} name="notes" required style={{ minWidth: 260 }} />
                <button type="submit" className="secondary">
                  Request revision
                </button>
              </form>
            ) : null}
          </div>
        );
      })}

      {sessionClips.length > 0 ? (
        <>
          <h2>Session clips</h2>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Auto-selected moments from a long ingested session, confirmed with local speech-to-text.
            Evidence for the selection is below each clip; it is not a gameplay claim.
          </p>
        </>
      ) : null}
      {sessionClips.map((c) => {
        const sig = (c.signalsJson ?? {}) as {
          reasons?: string[];
          transcriptExcerpt?: string | null;
        };
        const qa = (c.qaJson ?? null) as Qa | null;
        const gone = c.reviewState === "REJECTED";
        const m = c.captureSession.media;
        const clearance = externalClearance({
          now: new Date(),
          destination: null,
          media: m
            ? {
                rightsStatus: m.rightsStatus,
                rightsReviewDecision: m.rightsReviewDecision,
                thirdPartyNotes: m.thirdPartyNotes,
              }
            : null,
          agreement: m?.agreement ?? null,
          clipOwnerApproved: c.reviewState === "MIKE_APPROVED",
          platformAccountVerified: false,
        });
        return (
          <div className="card" key={c.id} data-testid="library-clip-item">
            <h2 style={{ marginBottom: 4 }}>{c.captureSession.content.workingTitle}</h2>
            <p style={{ margin: 0 }}>
              moment {c.rank} · {c.format} · {c.resolution} · {c.durationSec.toFixed(1)}s{" "}
              <span
                className={`badge ${c.reviewState === "MIKE_APPROVED" ? "CONFIRMED" : gone ? "LEAKED" : "UNVERIFIED"}`}
              >
                {STATE[c.reviewState ?? ""] ?? c.reviewState}
              </span>{" "}
              <span className="badge LEAKED">PUBLICATION BLOCKED</span>{" "}
              <span className="badge RUMOR">
                {clearance.creator.ok ? "CREATOR RIGHTS OK" : "RIGHTS OPEN"}
              </span>
            </p>
            {!gone ? (
              <details data-testid="clip-clearance" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                <summary>
                  Internal draft export: available · External delivery:{" "}
                  <strong>{clearance.cleared ? "cleared" : "BLOCKED"}</strong>
                </summary>
                <ul style={{ margin: "4px 0 8px 18px" }}>
                  {(
                    [
                      ["Creator rights", clearance.creator],
                      ["Platform", clearance.platform],
                      ["Publisher & editorial", clearance.publisher],
                    ] as const
                  ).map(([name, layer]) => (
                    <li key={name}>
                      {name}: {layer.ok ? "OK" : layer.reasons.join("; ")}
                    </li>
                  ))}
                </ul>
                <Link href="/studio/rights">Creators &amp; rights</Link> ·{" "}
                <Link href="/studio/platforms">Platform connections</Link>
              </details>
            ) : null}
            {gone ? (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Revision requested{c.reviewNotes ? `: ${c.reviewNotes}` : ""}. The file is no longer
                served. Clip the session again from{" "}
                <Link href="/studio/captures">Capture intake</Link>.
              </p>
            ) : (
              <div
                className="row"
                style={{ gap: 16, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}
              >
                <div>
                  <video
                    controls
                    preload="metadata"
                    poster={`/studio/media/clip-cover/${c.id}`}
                    style={{ width: c.format === "16:9" ? 420 : 220, background: "#000" }}
                    src={`/studio/media/clip/${c.id}`}
                  />
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    Captions are burned into the picture.{" "}
                    <a href={`/studio/media/clip-captions/${c.id}`}>Caption file (SRT)</a> ·{" "}
                    <a href={`/studio/media/clip-bundle/${c.id}`}>
                      internal draft export (review bundle)
                    </a>
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    SHA-256: <code>{c.checksumSha256}</code>
                  </div>
                </div>
                <div style={{ fontSize: "0.82rem", flex: 1, minWidth: 320 }}>
                  <details open>
                    <summary>
                      <strong>Moment evidence</strong>
                    </summary>
                    <ul style={{ margin: "4px 0 8px 18px" }}>
                      <li>
                        {c.startSec.toFixed(1)}s – {c.endSec.toFixed(1)}s, score{" "}
                        {c.score.toFixed(2)}
                      </li>
                      {(sig.reasons ?? []).length ? (
                        <li>{(sig.reasons ?? []).join("; ")}</li>
                      ) : null}
                      <li>
                        transcript:{" "}
                        {sig.transcriptExcerpt
                          ? `"${sig.transcriptExcerpt}"`
                          : "no speech detected"}
                      </li>
                    </ul>
                  </details>
                  <details open>
                    <summary>
                      <strong>Automatic QA</strong>:{" "}
                      {qa
                        ? (qa.checks ?? []).some((x) => x.status === "FAIL")
                          ? "a check failed"
                          : "all checks passed"
                        : "not recorded"}
                    </summary>
                    <ul style={{ margin: "4px 0 8px 18px" }}>
                      {(qa?.checks ?? []).map((x) => (
                        <li key={x.name}>
                          {x.status} — {x.name}: {x.detail}
                        </li>
                      ))}
                    </ul>
                    {qa?.humanValidation?.length ? (
                      <p>Still needs a person: {qa.humanValidation.join("; ")}</p>
                    ) : null}
                  </details>
                </div>
              </div>
            )}
            {!gone && c.reviewState === "PENDING_MIKE_REVIEW" && mayApprove ? (
              <form
                action={approveSessionClipAction}
                className="row"
                style={{ gap: 8, marginTop: 8 }}
              >
                <input type="hidden" name="clipId" value={c.id} />
                <label htmlFor={`clip-sha-${c.id}`} style={{ margin: 0 }}>
                  Owner approval of this exact file — type the first 8 characters of its SHA-256
                </label>
                <input
                  id={`clip-sha-${c.id}`}
                  name="checksumPrefix"
                  autoComplete="off"
                  pattern="[0-9a-fA-F]{8,64}"
                  required
                  style={{ width: 140 }}
                />
                <button type="submit">Approve internally</button>
              </form>
            ) : null}
            {c.reviewState === "MIKE_APPROVED" ? (
              <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                Owner approved file <code>{c.approvedChecksum?.slice(0, 12)}…</code>. Approval is
                internal; nothing here publishes.
              </p>
            ) : null}
            {!gone && c.reviewState === "PENDING_MIKE_REVIEW" && mayReview ? (
              <form
                action={reviewSessionClipAction}
                className="row"
                style={{ gap: 8, marginTop: 8 }}
              >
                <input type="hidden" name="clipId" value={c.id} />
                <input type="hidden" name="decision" value="REJECTED" />
                <label htmlFor={`clip-notes-${c.id}`} style={{ margin: 0 }}>
                  What needs to change
                </label>
                <input id={`clip-notes-${c.id}`} name="notes" required style={{ minWidth: 260 }} />
                <button type="submit" className="secondary">
                  Request revision
                </button>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
