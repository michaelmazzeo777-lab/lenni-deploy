import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { humanStatus, Badge } from "@/app/_ui";
import {
  createVisualBriefAction,
  approveVisualPromptAction,
  generateMockVisualAction,
  importVisualResultAction,
  reviewVisualAssetAction,
} from "@/app/studio/production-actions";
import { VisualKind, DisclosureDecision } from "@prisma/client";

export async function VisualsTab({ actor, contentId }: { actor: Actor; contentId: string }) {
  const briefs = await prisma.visualBrief.findMany({
    where: { contentId },
    include: { assets: true },
    orderBy: { createdAt: "desc" },
  });
  const mayBrief = can(actor, "visual.brief");
  const mayApprove = can(actor, "packaging.approve");
  const mayImport = can(actor, "visual.import");
  const mayReview = can(actor, "visual.review");

  return (
    <div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Synthetic media is limited to clearly original supporting visuals. Providers never run
        automatically: approve the prompt + cost ceiling, export the packet, generate outside the
        app, import the result, then pass AI-disclosure and rights review. Higgsfield/Gemini
        adapters exist but are <strong>disabled</strong> (approval required).
      </p>

      {briefs.map((b) => (
        <div className="card" key={b.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>[{humanStatus(b.kind)}]</strong> {b.title}{" "}
              <span className="badge">{humanStatus(b.status)}</span>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                Prompt: {b.prompt.slice(0, 120)} · cost ceiling ${b.costCeiling}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {mayApprove && b.status === "DRAFT" ? (
                <form action={approveVisualPromptAction}>
                  <input type="hidden" name="contentId" value={contentId} />
                  <input type="hidden" name="briefId" value={b.id} />
                  <button type="submit" className="secondary">
                    Approve prompt
                  </button>
                </form>
              ) : null}
              {mayImport && b.status !== "DRAFT" ? (
                <form action={generateMockVisualAction}>
                  <input type="hidden" name="contentId" value={contentId} />
                  <input type="hidden" name="briefId" value={b.id} />
                  <button type="submit" className="secondary">
                    Generate (mock)
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          {b.assets.length ? (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Provider / model</th>
                  <th>Cost</th>
                  <th>Disclosure</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {b.assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.provider}/{a.model}
                      <div className="muted" style={{ fontSize: "0.72rem" }}>
                        {a.location ?? ""} {a.aiGenerated ? "· AI-generated" : ""}
                      </div>
                    </td>
                    <td className="muted">${a.cost}</td>
                    <td className="muted">
                      {a.disclosureDecision ? humanStatus(a.disclosureDecision) : "—"}
                    </td>
                    <td>
                      <Badge
                        kind={
                          a.status === "APPROVED"
                            ? "CONFIRMED"
                            : a.status === "PENDING_REVIEW"
                              ? "UNVERIFIED"
                              : "LEAKED"
                        }
                        label={humanStatus(a.status)}
                      />
                    </td>
                    <td>
                      {mayReview && a.status === "PENDING_REVIEW" ? (
                        <form action={reviewVisualAssetAction} className="row" style={{ gap: 4 }}>
                          <input type="hidden" name="contentId" value={contentId} />
                          <input type="hidden" name="assetId" value={a.id} />
                          <select name="decision" defaultValue="APPROVED" style={{ width: 110 }}>
                            <option value="APPROVED">Approve</option>
                            <option value="REJECTED">Reject</option>
                            <option value="BLOCKED">Block</option>
                          </select>
                          <select
                            name="disclosureDecision"
                            defaultValue="PRODUCTION_ASSISTANCE_ONLY"
                            style={{ width: 180 }}
                          >
                            {Object.values(DisclosureDecision).map((d) => (
                              <option key={d} value={d}>
                                {humanStatus(d)}
                              </option>
                            ))}
                          </select>
                          <input name="reviewNotes" placeholder="Notes" style={{ width: 110 }} />
                          <button type="submit" className="secondary">
                            Review
                          </button>
                        </form>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.78rem" }}>
                          {a.rejectionReason ?? a.reviewNotes ?? ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {mayImport && b.status !== "DRAFT" ? (
            <details style={{ marginTop: 8 }}>
              <summary>Import external result (manual provider)</summary>
              <form action={importVisualResultAction} className="row" style={{ gap: 8 }}>
                <input type="hidden" name="contentId" value={contentId} />
                <input type="hidden" name="briefId" value={b.id} />
                <div style={{ flex: "1 1 120px" }}>
                  <label htmlFor={`prov-${b.id}`}>Provider</label>
                  <input id={`prov-${b.id}`} name="provider" placeholder="manual" required />
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <label htmlFor={`model-${b.id}`}>Actual model ID</label>
                  <input id={`model-${b.id}`} name="model" required />
                </div>
                <div style={{ flex: "1 1 90px" }}>
                  <label htmlFor={`cost-${b.id}`}>Cost</label>
                  <input id={`cost-${b.id}`} name="cost" type="number" step="0.01" min={0} />
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <label htmlFor={`loc-${b.id}`}>Location / link</label>
                  <input id={`loc-${b.id}`} name="location" />
                </div>
                <div style={{ alignSelf: "flex-end" }}>
                  <button type="submit" className="secondary">
                    Import
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </div>
      ))}
      {briefs.length === 0 ? <p className="muted">No visual briefs yet.</p> : null}

      {mayBrief ? (
        <div className="card">
          <h2>New visual brief</h2>
          <form action={createVisualBriefAction}>
            <input type="hidden" name="contentId" value={contentId} />
            <label htmlFor="vkind">Kind</label>
            <select id="vkind" name="kind" defaultValue="DIAGRAM">
              {Object.values(VisualKind).map((k) => (
                <option key={k} value={k}>
                  {humanStatus(k)}
                </option>
              ))}
            </select>
            <label htmlFor="vtitle">Title</label>
            <input id="vtitle" name="title" required />
            <label htmlFor="vprompt">Prompt (original supporting visual only)</label>
            <textarea id="vprompt" name="prompt" required />
            <label htmlFor="vneg">Negative instructions</label>
            <input
              id="vneg"
              name="negativePrompt"
              placeholder="No GTA gameplay imitation, no Rockstar marks…"
            />
            <label htmlFor="vcost">Cost ceiling ($)</label>
            <input
              id="vcost"
              name="costCeiling"
              type="number"
              step="0.01"
              min={0}
              defaultValue={0}
            />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Create brief</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
