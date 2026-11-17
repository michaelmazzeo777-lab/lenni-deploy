import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { expireDueAgreements } from "@/domain/creatorRights";
import { effectiveStatus, NEXT, STATUS_LABEL, TERMS_EDITABLE } from "@/lib/rights/agreements";
import {
  createAgreementDraftAction,
  createCreatorAction,
  linkMediaAction,
  qualifyCreatorAction,
  reviewMediaRightsAction,
  transitionAgreementAction,
  updateTermsAction,
} from "@/app/studio/rights-actions";

export const metadata = { title: "Creators & rights — Field Guide Studio" };
export const dynamic = "force-dynamic";

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");

export default async function RightsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error, ok } = await searchParams;
  const mayEdit = can(actor, "rights.review");
  if (mayEdit) await expireDueAgreements(actor); // records any expiry that is due
  const now = new Date();
  const [creators, agreements, media] = await Promise.all([
    prisma.creator.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.creatorAgreement.findMany({
      where: { workspaceId: actor.workspaceId },
      include: {
        creator: true,
        events: { orderBy: { createdAt: "asc" } },
        _count: { select: { media: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.captureMedia.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { agreement: true, captureSession: { include: { content: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const usable = agreements.filter((a) => a.status !== "REJECTED");

  return (
    <div>
      <h1>Creators &amp; footage rights</h1>
      <p className="muted" style={{ maxWidth: 820 }}>
        Internal records only. The Studio never contacts a creator, sends or signs an agreement, or
        clears a video for publication. A status records what Mike did or verified outside the
        Studio, with the evidence for it. Templates are drafts that need professional legal review.
        A creator cannot license music, Rockstar/Take-Two rights or anything else they do not own.
      </p>
      <Banner error={error} ok={ok} />

      <div className="card" data-testid="creators">
        <h2>Creators ({creators.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Tier</th>
              <th>Games</th>
              <th>Source</th>
              <th>Status</th>
              <th>Next permitted action</th>
            </tr>
          </thead>
          <tbody>
            {creators.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={c.profileUrl} target="_blank" rel="noreferrer noopener">
                    {c.name}
                  </a>{" "}
                  <span className="muted">({c.platform})</span>
                  {c.audienceNote ? (
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {c.audienceNote}
                    </div>
                  ) : null}
                  {c.rightsComplications ? (
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      Rights: {c.rightsComplications}
                    </div>
                  ) : null}
                </td>
                <td>
                  {c.tier === "HIGH_PROFILE" ? "High profile" : c.tier ? "Realistic partner" : "—"}
                </td>
                <td>{c.games.join(", ") || "—"}</td>
                <td style={{ fontSize: "0.78rem" }}>
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
                    source
                  </a>{" "}
                  {d(c.retrievedAt)} · confidence {c.confidence}
                </td>
                <td>
                  <span
                    className={`badge ${c.status === "QUALIFIED" ? "CONFIRMED" : "UNVERIFIED"}`}
                  >
                    {c.status}
                  </span>
                  {c.status === "PROSPECT" && mayEdit ? (
                    <form action={qualifyCreatorAction} style={{ marginTop: 4 }}>
                      <input type="hidden" name="creatorId" value={c.id} />
                      <label
                        htmlFor={`q-${c.id}`}
                        className="muted"
                        style={{ fontSize: "0.75rem" }}
                      >
                        Why they qualify
                      </label>
                      <input id={`q-${c.id}`} name="evidence" required minLength={10} />
                      <button type="submit" className="secondary">
                        Mark qualified
                      </button>
                    </form>
                  ) : null}
                </td>
                <td style={{ fontSize: "0.82rem" }}>
                  {c.nextAction ?? "—"}
                  {c.status === "QUALIFIED" && mayEdit ? (
                    <details>
                      <summary>Draft an agreement</summary>
                      <form action={createAgreementDraftAction}>
                        <input type="hidden" name="creatorId" value={c.id} />
                        <label htmlFor={`scope-${c.id}`}>Footage scope</label>
                        <input id={`scope-${c.id}`} name="footageScope" />
                        <label htmlFor={`dest-${c.id}`}>
                          Approved destinations (comma-separated)
                        </label>
                        <input
                          id={`dest-${c.id}`}
                          name="approvedDestinations"
                          placeholder="youtube"
                        />
                        <label>
                          <input type="checkbox" name="editingAllowed" /> Editing allowed
                        </label>
                        <label>
                          <input type="checkbox" name="derivativesAllowed" /> Derivative clips
                          allowed
                        </label>
                        <label>
                          <input type="checkbox" name="commercialUse" /> Commercial use
                        </label>
                        <label>
                          <input type="checkbox" name="monetizationAllowed" /> Monetization
                        </label>
                        <label htmlFor={`attr-${c.id}`}>Attribution</label>
                        <input id={`attr-${c.id}`} name="attribution" />
                        <label htmlFor={`comp-${c.id}`}>Proposed compensation (if any)</label>
                        <input id={`comp-${c.id}`} name="compensationTerms" />
                        <label htmlFor={`exp-${c.id}`}>Proposed expiry</label>
                        <input id={`exp-${c.id}`} name="expiresAt" type="date" />
                        <button type="submit">Create draft (not sent)</button>
                      </form>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
            {creators.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No creators recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {mayEdit ? (
          <details style={{ marginTop: 8 }}>
            <summary>Record a prospect from public research</summary>
            <form action={createCreatorAction} style={{ maxWidth: 520 }}>
              <label htmlFor="c-name">Name</label>
              <input id="c-name" name="name" required />
              <label htmlFor="c-platform">Platform</label>
              <select id="c-platform" name="platform">
                {["youtube", "twitch", "kick", "tiktok", "instagram", "facebook", "other"].map(
                  (p) => (
                    <option key={p}>{p}</option>
                  ),
                )}
              </select>
              <label htmlFor="c-url">Public profile URL (https)</label>
              <input id="c-url" name="profileUrl" type="url" required />
              <label htmlFor="c-tier">Tier</label>
              <select id="c-tier" name="tier">
                <option value="REALISTIC_PARTNER">Realistic partner</option>
                <option value="HIGH_PROFILE">High profile</option>
              </select>
              <label htmlFor="c-games">Games (comma-separated)</label>
              <input id="c-games" name="games" />
              <label htmlFor="c-aud">Audience (only what you verified)</label>
              <input id="c-aud" name="audienceNote" />
              <label htmlFor="c-contact">Published business contact (optional)</label>
              <input id="c-contact" name="businessContact" />
              <label htmlFor="c-contact-src">Where it is published</label>
              <input id="c-contact-src" name="contactSource" type="url" />
              <label htmlFor="c-rights">Possible rights complications</label>
              <input id="c-rights" name="rightsComplications" />
              <label htmlFor="c-src">Research source URL</label>
              <input id="c-src" name="sourceUrl" type="url" required />
              <label htmlFor="c-conf">Confidence</label>
              <select id="c-conf" name="confidence">
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
              </select>
              <label htmlFor="c-next">Next permitted action</label>
              <input id="c-next" name="nextAction" />
              <button type="submit">Record prospect</button>
            </form>
          </details>
        ) : null}
      </div>

      <div className="card" data-testid="agreements">
        <h2>Agreements ({agreements.length})</h2>
        {agreements.length === 0 ? <p className="muted">No agreements yet.</p> : null}
        {agreements.map((a) => {
          const status = effectiveStatus(a, now);
          return (
            <div key={a.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
              <strong>{a.title}</strong>{" "}
              <span
                className={`badge ${status === "ACTIVE" ? "CONFIRMED" : status === "REVOKED" || status === "EXPIRED" || status === "REJECTED" ? "LEAKED" : "UNVERIFIED"}`}
              >
                {STATUS_LABEL[status]}
              </span>{" "}
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                {a.creator.name} · effective {d(a.effectiveAt)} · expires {d(a.expiresAt)} ·{" "}
                {a._count.media} recording(s) linked
              </span>
              <ul style={{ fontSize: "0.82rem", margin: "4px 0 4px 18px" }}>
                <li>Scope: {a.footageScope ?? "not set"}</li>
                <li>
                  Editing {a.editingAllowed ? "yes" : "no"} · derivatives{" "}
                  {a.derivativesAllowed ? "yes" : "no"} · commercial{" "}
                  {a.commercialUse ? "yes" : "no"} · monetization{" "}
                  {a.monetizationAllowed ? "yes" : "no"} · destinations{" "}
                  {a.approvedDestinations.join(", ") || "none"}
                </li>
                <li>Not covered: {a.excludedRights ?? "—"}</li>
                <li>Rights owner: {a.rightsOwner ?? "not recorded"}</li>
                {a.revocationReason ? <li>Revoked: {a.revocationReason}</li> : null}
              </ul>
              <details>
                <summary style={{ fontSize: "0.82rem" }}>History ({a.events.length})</summary>
                <ol style={{ fontSize: "0.78rem" }}>
                  {a.events.map((e) => (
                    <li key={e.id}>
                      {d(e.createdAt)} {e.fromStatus ?? "—"} → {e.toStatus}: {e.evidence}
                      {e.affectedJson ? " (affected assets recorded)" : ""}
                    </li>
                  ))}
                </ol>
              </details>
              {mayEdit && TERMS_EDITABLE.includes(status) ? (
                <details>
                  <summary style={{ fontSize: "0.82rem" }}>Edit terms</summary>
                  <form action={updateTermsAction} style={{ maxWidth: 520 }}>
                    <input type="hidden" name="agreementId" value={a.id} />
                    <label htmlFor={`ro-${a.id}`}>Rights owner</label>
                    <input
                      id={`ro-${a.id}`}
                      name="rightsOwner"
                      defaultValue={a.rightsOwner ?? ""}
                    />
                    <label htmlFor={`oe-${a.id}`}>Ownership evidence</label>
                    <input
                      id={`oe-${a.id}`}
                      name="ownershipEvidence"
                      defaultValue={a.ownershipEvidence ?? ""}
                    />
                    <label htmlFor={`fs-${a.id}`}>Footage scope</label>
                    <input
                      id={`fs-${a.id}`}
                      name="footageScope"
                      defaultValue={a.footageScope ?? ""}
                    />
                    <label htmlFor={`ad-${a.id}`}>Approved destinations</label>
                    <input
                      id={`ad-${a.id}`}
                      name="approvedDestinations"
                      defaultValue={a.approvedDestinations.join(", ")}
                    />
                    <label>
                      <input
                        type="checkbox"
                        name="editingAllowed"
                        defaultChecked={a.editingAllowed}
                      />{" "}
                      Editing
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="derivativesAllowed"
                        defaultChecked={a.derivativesAllowed}
                      />{" "}
                      Derivatives
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="commercialUse"
                        defaultChecked={a.commercialUse}
                      />{" "}
                      Commercial
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="monetizationAllowed"
                        defaultChecked={a.monetizationAllowed}
                      />{" "}
                      Monetization
                    </label>
                    <label htmlFor={`at-${a.id}`}>Attribution</label>
                    <input
                      id={`at-${a.id}`}
                      name="attribution"
                      defaultValue={a.attribution ?? ""}
                    />
                    <label htmlFor={`ct-${a.id}`}>Compensation</label>
                    <input
                      id={`ct-${a.id}`}
                      name="compensationTerms"
                      defaultValue={a.compensationTerms ?? ""}
                    />
                    <label htmlFor={`ex-${a.id}`}>Not covered (music, publisher rights...)</label>
                    <input
                      id={`ex-${a.id}`}
                      name="excludedRights"
                      defaultValue={a.excludedRights ?? ""}
                    />
                    <button type="submit" className="secondary">
                      Save terms
                    </button>
                  </form>
                </details>
              ) : null}
              {mayEdit && NEXT[status].length ? (
                <form
                  action={transitionAgreementAction}
                  className="row"
                  style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
                >
                  <input type="hidden" name="agreementId" value={a.id} />
                  <div>
                    <label htmlFor={`to-${a.id}`}>Record next step</label>
                    <select id={`to-${a.id}`} name="to">
                      {NEXT[status].map((n) => (
                        <option key={n} value={n}>
                          {STATUS_LABEL[n]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 260px" }}>
                    <label htmlFor={`ev-${a.id}`}>Evidence for this step</label>
                    <input id={`ev-${a.id}`} name="evidence" required minLength={10} />
                  </div>
                  <details style={{ flexBasis: "100%" }}>
                    <summary style={{ fontSize: "0.78rem" }}>
                      Legal review, signature and dates (when the step needs them)
                    </summary>
                    <label htmlFor={`lr-${a.id}`}>Legal reviewer</label>
                    <input id={`lr-${a.id}`} name="legalReviewer" />
                    <label htmlFor={`ln-${a.id}`}>Legal review outcome</label>
                    <input id={`ln-${a.id}`} name="legalReviewNote" />
                    <label htmlFor={`sg-${a.id}`}>
                      Signature evidence (where the signed copy is, how verified)
                    </label>
                    <input id={`sg-${a.id}`} name="signatureEvidence" />
                    <label htmlFor={`ef-${a.id}`}>Effective date</label>
                    <input id={`ef-${a.id}`} name="effectiveAt" type="date" />
                    <label htmlFor={`xp-${a.id}`}>Expiry date</label>
                    <input id={`xp-${a.id}`} name="expiresAt" type="date" />
                  </details>
                  <button type="submit">Record step</button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="card" data-testid="footage-rights">
        <h2>Footage provenance</h2>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          Every ingested recording, with its rights basis. Internal processing (clipping, review
          bundles) is allowed; external delivery needs an active agreement or owned capture, a human
          rights review, a verified platform account and the publisher/editorial review.
        </p>
        <table>
          <thead>
            <tr>
              <th>Recording</th>
              <th>Rights basis</th>
              <th>Agreement</th>
              <th>Rights review</th>
            </tr>
          </thead>
          <tbody>
            {media.map((m) => (
              <tr key={m.id}>
                <td style={{ fontSize: "0.82rem" }}>
                  {m.originalName}
                  <div className="muted">
                    {m.captureSession.content.workingTitle} · {m.captureSession.platform}{" "}
                    {m.captureSession.gameVersion} · {m.gameMode ?? ""} · {d(m.createdAt)} · SHA-256{" "}
                    {m.checksumSha256.slice(0, 12)}…
                  </div>
                  {m.thirdPartyNotes ? (
                    <div className="muted">Third-party: {m.thirdPartyNotes}</div>
                  ) : null}
                </td>
                <td>{m.rightsStatus.replace(/_/g, " ")}</td>
                <td style={{ fontSize: "0.82rem" }}>
                  {m.agreement
                    ? `${m.agreement.title} (${STATUS_LABEL[effectiveStatus(m.agreement, now)]})`
                    : "—"}
                  {mayEdit ? (
                    <form action={linkMediaAction}>
                      <input type="hidden" name="captureMediaId" value={m.id} />
                      <label
                        htmlFor={`lk-${m.id}`}
                        className="muted"
                        style={{ fontSize: "0.75rem" }}
                      >
                        Link agreement
                      </label>
                      <select
                        id={`lk-${m.id}`}
                        name="agreementId"
                        defaultValue={m.agreementId ?? ""}
                      >
                        <option value="">None (owned capture)</option>
                        {usable.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                      <label
                        htmlFor={`tp-${m.id}`}
                        className="muted"
                        style={{ fontSize: "0.75rem" }}
                      >
                        Music / third-party restrictions
                      </label>
                      <input
                        id={`tp-${m.id}`}
                        name="thirdPartyNotes"
                        defaultValue={m.thirdPartyNotes ?? ""}
                      />
                      <button type="submit" className="secondary">
                        Save
                      </button>
                    </form>
                  ) : null}
                </td>
                <td style={{ fontSize: "0.82rem" }}>
                  {m.rightsReviewDecision
                    ? `${m.rightsReviewDecision}: ${m.rightsReviewNote}`
                    : "Not reviewed"}
                  {mayEdit ? (
                    <form action={reviewMediaRightsAction}>
                      <input type="hidden" name="captureMediaId" value={m.id} />
                      <label
                        htmlFor={`rn-${m.id}`}
                        className="muted"
                        style={{ fontSize: "0.75rem" }}
                      >
                        Reasoning
                      </label>
                      <input id={`rn-${m.id}`} name="note" required minLength={10} />
                      <button type="submit" name="decision" value="APPROVED" className="secondary">
                        Rights approved
                      </button>{" "}
                      <button type="submit" name="decision" value="REJECTED" className="secondary">
                        Rights rejected
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {media.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No recordings ingested yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
