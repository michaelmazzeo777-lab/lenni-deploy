import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudioActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { can, canGrantScope } from "@/lib/permissions";
import { WORKFLOW_ORDER } from "@/domain/workflow";
import { evaluateReadyReadiness, READY_REQUIRED_SCOPES } from "@/domain/approval";
import { rightsBlockers } from "@/domain/rights";
import { Banner, Badge, humanStatus } from "@/app/_ui";
import type { Actor } from "@/lib/auth/context";
import type { ApprovalScope } from "@prisma/client";
import {
  transitionAction,
  linkClaimAction,
  saveScriptAction,
  createAssetAction,
  reviewAssetAction,
  createTitleAction,
  createThumbnailAction,
  createExperimentAction,
  concludeExperimentAction,
  generateAction,
  reviewGenerationAction,
  grantApprovalAction,
  publishAction,
  createCorrectionAction,
} from "@/app/studio/actions";
import {
  uploadAssetFileAction,
  scanStoredFileAction,
  discardRejectedFileAction,
} from "@/app/studio/production-actions";
import { ProductionTab } from "./production-tab";
import { VisualsTab } from "./visuals-tab";

export const dynamic = "force-dynamic";

const TABS = [
  "overview",
  "evidence",
  "script",
  "production",
  "visuals",
  "assets",
  "packaging",
  "ai",
  "approvals",
  "publication",
  "corrections",
  "audit",
] as const;

export default async function ContentDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStudioActor();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "overview";

  const content = await prisma.contentItem.findFirst({
    where: { id, workspaceId: actor.workspaceId },
  });
  if (!content) notFound();

  const readiness = await evaluateReadyReadiness(id);
  const notice = sp.published ? `Published to the public site: /guides/${sp.published}` : undefined;

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Link href="/studio/content" className="muted">
          ← Backlog
        </Link>
      </div>
      <h1 style={{ marginBottom: 4 }}>{content.workingTitle}</h1>
      <div className="article-meta">
        <span>{humanStatus(content.type)}</span>
        <span>· {humanStatus(content.pillar)}</span>
        <span>
          · Status: <strong>{humanStatus(content.status)}</strong>
        </span>
        <Badge kind="spoiler" label={`Spoiler: ${humanStatus(content.spoilerLevel)}`} />
        {readiness.ready ? (
          <span className="badge CONFIRMED">READY criteria met</span>
        ) : (
          <span className="badge">{readiness.missingScopes.length} approvals pending</span>
        )}
      </div>

      <Banner error={sp.error} ok={notice} />

      <nav className="tabs" aria-label="Content sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/studio/content/${id}?tab=${t}`}
            className={t === tab ? "active" : ""}
          >
            {humanStatus(t)}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview actor={actor} content={content} readiness={readiness} />}
      {tab === "evidence" && <Evidence actor={actor} contentId={id} />}
      {tab === "script" && <Script actor={actor} contentId={id} />}
      {tab === "production" && <ProductionTab actor={actor} contentId={id} />}
      {tab === "visuals" && <VisualsTab actor={actor} contentId={id} />}
      {tab === "assets" && <Assets actor={actor} contentId={id} />}
      {tab === "packaging" && <Packaging actor={actor} contentId={id} />}
      {tab === "ai" && <AIWorkbench actor={actor} contentId={id} selectedGen={sp.gen} />}
      {tab === "approvals" && <Approvals actor={actor} contentId={id} />}
      {tab === "publication" && <Publication actor={actor} contentId={id} />}
      {tab === "corrections" && <Corrections actor={actor} contentId={id} />}
      {tab === "audit" && <AuditTab contentId={id} />}
    </div>
  );
}

// ---------- Overview ----------
async function Overview({
  actor,
  content,
  readiness,
}: {
  actor: Actor;
  content: { id: string; status: string };
  readiness: Awaited<ReturnType<typeof evaluateReadyReadiness>>;
}) {
  const mayTransition = can(actor, "content.transition");
  const mayOverride = can(actor, "content.transition.override");
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "1 1 360px" }}>
        <h2>Workflow</h2>
        <p className="muted">
          Current: <strong>{humanStatus(content.status)}</strong>
        </p>
        <ol className="muted" style={{ fontSize: "0.82rem", lineHeight: 1.8 }}>
          {WORKFLOW_ORDER.map((s) => (
            <li key={s} style={{ fontWeight: s === content.status ? 800 : 400 }}>
              {humanStatus(s)}
            </li>
          ))}
        </ol>
      </div>
      <div className="card" style={{ flex: "1 1 360px" }}>
        <h2>Advance / change status</h2>
        {mayTransition ? (
          <form action={transitionAction}>
            <input type="hidden" name="contentId" value={content.id} />
            <label htmlFor="to">Target status</label>
            <select id="to" name="to">
              {WORKFLOW_ORDER.map((sx) => (
                <option key={sx} value={sx}>
                  {humanStatus(sx)}
                </option>
              ))}
            </select>
            <label htmlFor="reason">Reason (required for overrides)</label>
            <input id="reason" name="reason" />
            {mayOverride ? (
              <label style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input type="checkbox" name="override" style={{ width: "auto" }} /> Owner override
                (skip a step)
              </label>
            ) : null}
            <div style={{ marginTop: 12 }}>
              <button type="submit">Apply transition</button>
            </div>
          </form>
        ) : (
          <p className="muted">Your role cannot change workflow status.</p>
        )}
        <hr style={{ borderColor: "var(--border)", margin: "16px 0" }} />
        <h3>READY readiness</h3>
        <ul className="muted" style={{ fontSize: "0.85rem" }}>
          <li>
            Missing approvals: {readiness.missingScopes.map(humanStatus).join(", ") || "none"}
          </li>
          <li>Rights blockers: {readiness.rightsBlockers.length}</li>
          <li>Blocking corrections: {readiness.blockingCorrections}</li>
        </ul>
      </div>
    </div>
  );
}

// ---------- Evidence ----------
async function Evidence({ actor, contentId }: { actor: Actor; contentId: string }) {
  const [linked, reviewedClaims] = await Promise.all([
    prisma.contentClaim.findMany({
      where: { contentId },
      include: { claim: { include: { sources: { include: { source: true } } } } },
    }),
    prisma.claim.findMany({
      where: {
        workspaceId: actor.workspaceId,
        status: "REVIEWED",
        classification: { not: "LEAKED" },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const linkedIds = new Set(linked.map((l) => l.claimId));
  const linkable = reviewedClaims.filter((c) => !linkedIds.has(c.id));
  const mayEdit = can(actor, "content.edit");

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "2 1 480px" }}>
        <h2>Linked claims ({linked.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Statement</th>
              <th>Class</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {linked.map((l) => (
              <tr key={l.id}>
                <td>{l.claim.statement}</td>
                <td>
                  <Badge kind={l.claim.classification} />
                </td>
                <td className="muted">
                  {l.claim.sources.map((cs) => cs.source.publisher).join(", ") || "—"}
                </td>
              </tr>
            ))}
            {linked.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No claims linked yet. Link a reviewed claim to reach EVIDENCE_READY.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {mayEdit ? (
        <div className="card" style={{ flex: "1 1 300px" }}>
          <h2>Link a reviewed claim</h2>
          {linkable.length ? (
            <form action={linkClaimAction}>
              <input type="hidden" name="contentId" value={contentId} />
              <label htmlFor="claimId">Reviewed claim</label>
              <select id="claimId" name="claimId">
                {linkable.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.classification}] {c.statement.slice(0, 60)}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input type="checkbox" name="required" style={{ width: "auto" }} /> Required claim
              </label>
              <div style={{ marginTop: 12 }}>
                <button type="submit">Link claim</button>
              </div>
            </form>
          ) : (
            <p className="muted">
              No reviewed, unlinked claims. Create and review claims in{" "}
              <Link href="/studio/claims">Claims</Link>.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Script ----------
async function Script({ actor, contentId }: { actor: Actor; contentId: string }) {
  const versions = await prisma.scriptVersion.findMany({
    where: { contentId },
    orderBy: { version: "desc" },
  });
  const latest = versions[0];
  const mayWrite = can(actor, "script.write");
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "2 1 480px" }}>
        <h2>Script editor</h2>
        {mayWrite ? (
          <form action={saveScriptAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <label htmlFor="body">
              Script body (saving creates a new version and invalidates prior approvals)
            </label>
            <textarea
              id="body"
              name="body"
              defaultValue={latest?.body ?? ""}
              style={{ minHeight: 240 }}
              required
            />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Save new version</button>
            </div>
          </form>
        ) : (
          <pre style={{ whiteSpace: "pre-wrap" }}>{latest?.body ?? "No script yet."}</pre>
        )}
      </div>
      <div className="card" style={{ flex: "1 1 260px" }}>
        <h2>Version history</h2>
        <ul className="muted" style={{ fontSize: "0.85rem" }}>
          {versions.map((v) => (
            <li key={v.id}>
              v{v.version} — {v.wordCount} words, ~{v.estimatedDuration}s ({v.authorType})
            </li>
          ))}
          {versions.length === 0 ? <li>No versions</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ---------- Assets ----------
async function Assets({ actor, contentId }: { actor: Actor; contentId: string }) {
  const [assets, blockers] = await Promise.all([
    prisma.asset.findMany({
      where: { contentId },
      include: { reviews: true, storedFile: true },
    }),
    rightsBlockers(contentId),
  ]);
  const mayCreate = can(actor, "asset.create");
  const mayReview = can(actor, "rights.review");
  const mayUpload = can(actor, "storage.upload");
  const mayScan = can(actor, "storage.scan");

  return (
    <div>
      {blockers.length ? (
        <p className="error">Rights blockers: {blockers.join("; ")}</p>
      ) : (
        <p className="notice">No rights blockers.</p>
      )}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 480px" }}>
          <h2>Asset ledger ({assets.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Ownership</th>
                <th>File</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    {a.flagLeaked ||
                    a.flagFakeTrailer ||
                    a.flagIsolatedCutscene ||
                    a.flagUnlicensedMusic ||
                    a.flagMassProducedAI ||
                    a.flagDeceptive ? (
                      <>
                        {" "}
                        <span className="badge LEAKED">prohibited</span>
                      </>
                    ) : null}
                  </td>
                  <td className="muted">{a.ownership}</td>
                  <td>
                    {a.storedFile ? (
                      <div style={{ fontSize: "0.8rem" }}>
                        <span
                          className={`badge ${
                            a.storedFile.quarantineStatus === "CLEAN"
                              ? "CONFIRMED"
                              : a.storedFile.quarantineStatus === "REJECTED"
                                ? "LEAKED"
                                : "UNVERIFIED"
                          }`}
                        >
                          {a.storedFile.quarantineStatus}
                        </span>
                        <div className="muted" style={{ fontSize: "0.72rem" }}>
                          {a.storedFile.originalName} ({a.storedFile.sizeBytes}b)
                        </div>
                        {a.storedFile.scanNotes ? (
                          <div className="muted" style={{ fontSize: "0.72rem" }}>
                            {a.storedFile.scanNotes}
                          </div>
                        ) : null}
                        {mayScan && a.storedFile.quarantineStatus === "PENDING" ? (
                          <form action={scanStoredFileAction}>
                            <input type="hidden" name="contentId" value={contentId} />
                            <input type="hidden" name="tab" value="assets" />
                            <input type="hidden" name="storedFileId" value={a.storedFile.id} />
                            <button
                              type="submit"
                              className="secondary"
                              style={{ marginTop: 4 }}
                              title="Deterministic mock check — not a real antivirus engine"
                            >
                              Run mock scan
                            </button>
                          </form>
                        ) : null}
                        {mayUpload && a.storedFile.quarantineStatus === "REJECTED" ? (
                          <form action={discardRejectedFileAction}>
                            <input type="hidden" name="contentId" value={contentId} />
                            <input type="hidden" name="tab" value="assets" />
                            <input type="hidden" name="storedFileId" value={a.storedFile.id} />
                            <button type="submit" className="secondary" style={{ marginTop: 4 }}>
                              Discard
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : mayUpload ? (
                      <form
                        action={uploadAssetFileAction}
                        encType="multipart/form-data"
                        className="row"
                        style={{ gap: 4 }}
                      >
                        <input type="hidden" name="contentId" value={contentId} />
                        <input type="hidden" name="assetId" value={a.id} />
                        <input
                          type="file"
                          name="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          required
                        />
                        <button type="submit" className="secondary">
                          Upload
                        </button>
                      </form>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                  <td>{a.status}</td>
                  <td>
                    {mayReview && a.status === "PENDING" ? (
                      <form action={reviewAssetAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="contentId" value={contentId} />
                        <input type="hidden" name="assetId" value={a.id} />
                        <select name="riskLevel" defaultValue="LOW" style={{ width: 110 }}>
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                          <option value="BLOCKED">Blocked</option>
                        </select>
                        <select name="decision" defaultValue="APPROVED" style={{ width: 130 }}>
                          <option value="APPROVED">Approve</option>
                          <option value="NEEDS_WORK">Needs work</option>
                          <option value="BLOCKED">Block</option>
                        </select>
                        <button type="submit" className="secondary">
                          Review
                        </button>
                      </form>
                    ) : (
                      <span className="muted">{a.reviews.length} review(s)</span>
                    )}
                  </td>
                </tr>
              ))}
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No assets yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {mayCreate ? (
          <div className="card" style={{ flex: "1 1 300px" }}>
            <h2>Add placeholder asset</h2>
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              Metadata only. No copyrighted media files.
            </p>
            <form action={createAssetAction}>
              <input type="hidden" name="contentId" value={contentId} />
              <label htmlFor="name">Name</label>
              <input id="name" name="name" required />
              <label htmlFor="mediaType">Media type</label>
              <input id="mediaType" name="mediaType" defaultValue="image" />
              <label htmlFor="ownership">Ownership</label>
              <select id="ownership" name="ownership" defaultValue="ORIGINAL">
                <option value="ORIGINAL">Original</option>
                <option value="THIRD_PARTY">Third party</option>
              </select>
              <label htmlFor="intendedUse">Intended use</label>
              <input id="intendedUse" name="intendedUse" />
              <fieldset
                style={{ border: "1px solid var(--border)", borderRadius: 6, marginTop: 10 }}
              >
                <legend className="muted" style={{ fontSize: "0.78rem" }}>
                  Prohibited-use flags (any blocks approval)
                </legend>
                {[
                  ["flagLeaked", "Leaked material"],
                  ["flagFakeTrailer", "Fake trailer"],
                  ["flagIsolatedCutscene", "Isolated cutscene"],
                  ["flagUnlicensedMusic", "Unlicensed music"],
                  ["flagMassProducedAI", "Mass-produced AI"],
                  ["flagDeceptive", "Deceptive"],
                ].map(([k, label]) => (
                  <label key={k} style={{ display: "flex", gap: 8 }}>
                    <input type="checkbox" name={k} style={{ width: "auto" }} /> {label}
                  </label>
                ))}
              </fieldset>
              <div style={{ marginTop: 12 }}>
                <button type="submit">Add asset</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Packaging ----------
async function Packaging({ actor, contentId }: { actor: Actor; contentId: string }) {
  const [titles, thumbs, experiments] = await Promise.all([
    prisma.titleVariant.findMany({ where: { contentId } }),
    prisma.thumbnailVariant.findMany({ where: { contentId } }),
    prisma.packagingExperiment.findMany({ where: { contentId }, orderBy: { startAt: "desc" } }),
  ]);
  const mayCreate = can(actor, "packaging.create");
  const mayConclude = can(actor, "packaging.approve");
  const titleById = new Map(titles.map((t) => [t.id, t.text]));
  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "1 1 360px" }}>
          <h2>Title variants ({titles.length})</h2>
          <ul>
            {titles.map((t) => (
              <li key={t.id}>
                {t.text} <span className="muted">({t.strategy})</span>
              </li>
            ))}
            {titles.length === 0 ? <li className="muted">None</li> : null}
          </ul>
          {mayCreate ? (
            <form action={createTitleAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="contentId" value={contentId} />
              <label htmlFor="text">Title text</label>
              <input id="text" name="text" required />
              <label htmlFor="strategy">Strategy</label>
              <select id="strategy" name="strategy" defaultValue="SEARCH_FIRST">
                <option value="SEARCH_FIRST">Search-first</option>
                <option value="BROWSE_FIRST">Browse-first</option>
              </select>
              <label style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  name="deceptionCheck"
                  style={{ width: "auto" }}
                  defaultChecked
                />{" "}
                Not deceptive / matches evidence
              </label>
              <div style={{ marginTop: 12 }}>
                <button type="submit">Add title</button>
              </div>
            </form>
          ) : null}
        </div>
        <div className="card" style={{ flex: "1 1 360px" }}>
          <h2>Thumbnail briefs ({thumbs.length})</h2>
          <ul>
            {thumbs.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>: {t.brief}
              </li>
            ))}
            {thumbs.length === 0 ? <li className="muted">None</li> : null}
          </ul>
          {mayCreate ? (
            <form action={createThumbnailAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="contentId" value={contentId} />
              <label htmlFor="tname">Name</label>
              <input id="tname" name="name" required />
              <label htmlFor="brief">Brief (original art only, no Rockstar marks)</label>
              <textarea id="brief" name="brief" required />
              <label style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  name="mobileCheck"
                  style={{ width: "auto" }}
                  defaultChecked
                />{" "}
                Mobile legible
              </label>
              <label style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  name="trademarkCheck"
                  style={{ width: "auto" }}
                  defaultChecked
                />{" "}
                No trademarked marks
              </label>
              <label style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  name="deceptionCheck"
                  style={{ width: "auto" }}
                  defaultChecked
                />{" "}
                Not deceptive
              </label>
              <div style={{ marginTop: 12 }}>
                <button type="submit">Add thumbnail brief</button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2>Title A/B experiments ({experiments.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Hypothesis</th>
              <th>Variant A</th>
              <th>Variant B</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((ex) => (
              <tr key={ex.id}>
                <td>{ex.hypothesis}</td>
                <td className="muted">{titleById.get(ex.variantAId) ?? ex.variantAId}</td>
                <td className="muted">{titleById.get(ex.variantBId) ?? ex.variantBId}</td>
                <td>
                  {ex.result ? (
                    <>
                      <strong>{ex.result}</strong>
                      {ex.conclusion ? (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {ex.conclusion}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">running</span>
                  )}
                </td>
                <td>
                  {mayConclude && !ex.result ? (
                    <form action={concludeExperimentAction} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="contentId" value={contentId} />
                      <input type="hidden" name="experimentId" value={ex.id} />
                      <select name="result" defaultValue="SUPPORTED" style={{ width: 130 }}>
                        <option value="SUPPORTED">Supported</option>
                        <option value="CONTRADICTED">Contradicted</option>
                        <option value="INCONCLUSIVE">Inconclusive</option>
                      </select>
                      <input
                        name="conclusion"
                        placeholder="Interpretation"
                        style={{ width: 160 }}
                      />
                      <button type="submit" className="secondary">
                        Conclude
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {experiments.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No experiments yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {mayCreate && titles.length >= 2 ? (
          <form action={createExperimentAction} className="row" style={{ gap: 8, marginTop: 12 }}>
            <input type="hidden" name="contentId" value={contentId} />
            <div style={{ flex: "2 1 240px" }}>
              <label htmlFor="hypothesis">Hypothesis</label>
              <input id="hypothesis" name="hypothesis" required />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="variantAId">Variant A</label>
              <select id="variantAId" name="variantAId">
                {titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="variantBId">Variant B</label>
              <select id="variantBId" name="variantBId" defaultValue={titles[1]?.id}>
                {titles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button type="submit">Start experiment</button>
            </div>
          </form>
        ) : mayCreate ? (
          <p className="muted">Add at least two title variants to start an A/B experiment.</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------- AI Workbench ----------
async function AIWorkbench({
  actor,
  contentId,
  selectedGen,
}: {
  actor: Actor;
  contentId: string;
  selectedGen?: string;
}) {
  const [linked, sources, generations] = await Promise.all([
    prisma.contentClaim.findMany({
      where: { contentId },
      include: { claim: true },
    }),
    prisma.source.findMany({ where: { workspaceId: actor.workspaceId, status: "ACTIVE" } }),
    prisma.aIGeneration.findMany({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const claims = linked.map((l) => l.claim).filter((c) => c.classification !== "LEAKED");
  const mayGenerate = can(actor, "ai.generate");
  const mayReview = can(actor, "ai.review");
  const selected = selectedGen ? generations.find((g) => g.id === selectedGen) : generations[0];

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "1 1 340px" }}>
        <h2>Generate content packet</h2>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          Grounded only in selected sources and claims. Deterministic mock provider by default.
          Output is validated and stored as a draft requiring human review.
        </p>
        {mayGenerate ? (
          <form action={generateAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <label htmlFor="sourceIds">Sources</label>
            <select id="sourceIds" name="sourceIds" multiple size={4}>
              {sources.map((sx) => (
                <option key={sx.id} value={sx.id}>
                  {sx.publisher}: {sx.title.slice(0, 40)}
                </option>
              ))}
            </select>
            <label htmlFor="claimIds">Claims (linked, non-leaked)</label>
            <select id="claimIds" name="claimIds" multiple size={4}>
              {claims.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.classification}] {c.statement.slice(0, 40)}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 12 }}>
              <button type="submit">Generate (mock)</button>
            </div>
          </form>
        ) : (
          <p className="muted">Your role cannot run AI generation.</p>
        )}
      </div>

      <div className="card" style={{ flex: "2 1 460px" }}>
        <h2>Generations ({generations.length})</h2>
        {generations.length === 0 ? <p className="muted">No generations yet.</p> : null}
        {selected ? (
          <div>
            <p>
              <strong>{selected.provider}</strong> / {selected.model} —{" "}
              <span
                className={`badge ${selected.validationStatus === "VALID" ? "CONFIRMED" : "LEAKED"}`}
              >
                {selected.validationStatus}
              </span>{" "}
              {selected.reviewDecision ? (
                <span className="badge">Reviewed: {selected.reviewDecision}</span>
              ) : null}
            </p>
            {selected.quarantineReason ? (
              <p className="error">Quarantine reason: {selected.quarantineReason}</p>
            ) : null}
            <details>
              <summary>View packet JSON</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.75rem",
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(selected.responseJson, null, 2)}
              </pre>
            </details>
            {mayReview && !selected.reviewDecision ? (
              <form
                action={reviewGenerationAction}
                className="row"
                style={{ marginTop: 10, gap: 6 }}
              >
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="generationId" value={selected.id} />
                <select name="decision" defaultValue="ACCEPT">
                  <option value="ACCEPT">Accept</option>
                  <option value="ACCEPT_WITH_EDITS">Accept with edits</option>
                  <option value="REJECT">Reject</option>
                  <option value="QUARANTINE">Quarantine</option>
                  <option value="NEEDS_SOURCE_WORK">Needs source work</option>
                  <option value="NEEDS_RIGHTS_REVIEW">Needs rights review</option>
                </select>
                <button type="submit" className="secondary">
                  Record review
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Approvals ----------
async function Approvals({ actor, contentId }: { actor: Actor; contentId: string }) {
  const approvals = await prisma.approval.findMany({
    where: { contentId },
    orderBy: { createdAt: "desc" },
  });
  const grantable: ApprovalScope[] = READY_REQUIRED_SCOPES.filter((sx) => canGrantScope(actor, sx));

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "2 1 460px" }}>
        <h2>Approvals</h2>
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Decision</th>
              <th>State</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <td>{humanStatus(a.scope)}</td>
                <td>{a.decision}</td>
                <td>
                  {a.revokedAt ? (
                    <span className="muted">superseded/revoked</span>
                  ) : (
                    <span className="badge CONFIRMED">live</span>
                  )}
                </td>
                <td className="muted">
                  {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
            {approvals.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No approvals yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          Required for READY: {READY_REQUIRED_SCOPES.map(humanStatus).join(", ")}.
        </p>
      </div>
      {grantable.length ? (
        <div className="card" style={{ flex: "1 1 300px" }}>
          <h2>Grant approval</h2>
          <form action={grantApprovalAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <label htmlFor="scope">Scope</label>
            <select id="scope" name="scope">
              {grantable.map((sx) => (
                <option key={sx} value={sx}>
                  {humanStatus(sx)}
                </option>
              ))}
            </select>
            <label htmlFor="decision">Decision</label>
            <select id="decision" name="decision" defaultValue="APPROVED">
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <label htmlFor="notes">Notes</label>
            <input id="notes" name="notes" />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Record approval</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ flex: "1 1 300px" }}>
          <p className="muted">Your role cannot grant the required scopes.</p>
        </div>
      )}
    </div>
  );
}

// ---------- Publication ----------
async function Publication({ actor, contentId }: { actor: Actor; contentId: string }) {
  const [revisions, publication, readiness] = await Promise.all([
    prisma.publicArticleRevision.findMany({
      where: { contentId },
      orderBy: { revision: "desc" },
    }),
    prisma.publication.findUnique({
      where: { contentId_channel: { contentId, channel: "PUBLIC_WEBSITE" } },
    }),
    evaluateReadyReadiness(contentId),
  ]);
  const mayPublish = can(actor, "publication.publish");

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "1 1 340px" }}>
        <h2>Publish to public website</h2>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          Creates an immutable public revision. No external/YouTube publishing.
        </p>
        {readiness.ready ? (
          <p className="notice">All READY preconditions satisfied.</p>
        ) : (
          <p className="error">
            Not READY: {readiness.missingScopes.map(humanStatus).join(", ") || "—"}
            {readiness.rightsBlockers.length
              ? `; rights blockers: ${readiness.rightsBlockers.length}`
              : ""}
          </p>
        )}
        {mayPublish ? (
          <form action={publishAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <button type="submit" disabled={!readiness.ready}>
              Publish public article
            </button>
          </form>
        ) : (
          <p className="muted">Only an Owner may publish.</p>
        )}
        {publication?.publicUrl ? (
          <p style={{ marginTop: 12 }}>
            Public URL:{" "}
            <a href={`/guides/${revisions[0]?.slug}`} target="_blank" rel="noreferrer">
              /guides/{revisions[0]?.slug}
            </a>
          </p>
        ) : null}
      </div>
      <div className="card" style={{ flex: "1 1 300px" }}>
        <h2>Revisions ({revisions.length})</h2>
        <ul className="muted" style={{ fontSize: "0.85rem" }}>
          {revisions.map((r) => (
            <li key={r.id}>
              rev {r.revision} — verified {r.lastVerifiedAt.toISOString().slice(0, 10)}
            </li>
          ))}
          {revisions.length === 0 ? <li>No revisions</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ---------- Corrections ----------
async function Corrections({ actor, contentId }: { actor: Actor; contentId: string }) {
  const corrections = await prisma.correction.findMany({
    where: { contentId },
    orderBy: { createdAt: "desc" },
  });
  const mayCreate = can(actor, "correction.create");
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "2 1 460px" }}>
        <h2>Corrections</h2>
        <ul>
          {corrections.map((c) => (
            <li key={c.id}>
              <strong>{c.severity}</strong> — {c.publicNotice}{" "}
              <span className="muted">({c.status})</span>
            </li>
          ))}
          {corrections.length === 0 ? <li className="muted">None</li> : null}
        </ul>
      </div>
      {mayCreate ? (
        <div className="card" style={{ flex: "1 1 320px" }}>
          <h2>Record correction</h2>
          <form action={createCorrectionAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <label htmlFor="severity">Severity</label>
            <select id="severity" name="severity" defaultValue="MINOR">
              <option value="MINOR">Minor</option>
              <option value="MODERATE">Moderate</option>
              <option value="MAJOR">Major</option>
            </select>
            <label htmlFor="originalText">Original text</label>
            <textarea id="originalText" name="originalText" required />
            <label htmlFor="correctedText">Corrected text</label>
            <textarea id="correctedText" name="correctedText" required />
            <label htmlFor="reason">Reason</label>
            <input id="reason" name="reason" required />
            <label htmlFor="publicNotice">Public notice</label>
            <input id="publicNotice" name="publicNotice" required />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Record correction</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Audit ----------
async function AuditTab({ contentId }: { contentId: string }) {
  const events = await prisma.auditEvent.findMany({
    where: { entityType: "ContentItem", entityId: contentId },
    orderBy: { createdAt: "desc" },
  });
  // Also include child-entity events referencing this content in metadata.
  return (
    <div className="card">
      <h2>Audit timeline ({events.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>
                {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </td>
              <td>
                <code>{e.action}</code>
              </td>
              <td className="muted" style={{ fontSize: "0.8rem" }}>
                {e.metadataJson ? JSON.stringify(e.metadataJson) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
