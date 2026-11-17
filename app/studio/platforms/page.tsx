import Link from "next/link";
import { requireStudioActor } from "@/lib/auth/guard";
import { FUNCTIONS, PLATFORMS, VERIFIED_ON, type Outcome } from "@/lib/platforms/capabilities";

export const metadata = { title: "Platform connections — Field Guide Studio" };
export const dynamic = "force-dynamic";

const BADGE: Record<Outcome, { text: string; cls: string }> = {
  IMPLEMENTED_LOCAL: { text: "In the Studio", cls: "CONFIRMED" },
  GUIDED_SETUP: { text: "Setup guide", cls: "UNVERIFIED" },
  NOT_SUPPORTED: { text: "Not available", cls: "LEAKED" },
};

export default async function PlatformsPage() {
  await requireStudioActor();
  return (
    <div>
      <h1>Platform connections</h1>
      <p className="muted" style={{ maxWidth: 820 }}>
        <strong>No account is connected.</strong> This build has no sign-in flow, stores no tokens
        and cannot upload, schedule or publish. Each row says what the platform offers (from its own
        documentation, read {VERIFIED_ON}), what the Studio does today, and what stays manual.
        Anything not confirmed in the documentation is marked unverified.
      </p>

      <div className="card" data-testid="manual-publishing">
        <h2>Manual publishing path (works today)</h2>
        <ol style={{ fontSize: "0.9rem" }}>
          <li>
            Review the clip in <Link href="/studio/library">Library &amp; review</Link> and approve
            the exact file by its SHA-256.
          </li>
          <li>
            Check its <em>External delivery</em> line: creator rights, platform and
            publisher/editorial review must all pass. Until they do, keep the file internal.
          </li>
          <li>Download the internal draft export (video, captions, transcript, manifest, QA).</li>
          <li>
            Open the platform below and upload by hand, using the caption file and the credit the
            agreement requires.
          </li>
          <li>Record what you published, and where, in the content item.</li>
        </ol>
      </div>

      {PLATFORMS.map((p) => (
        <div className="card" key={p.key} data-testid={`platform-${p.key}`}>
          <h2 style={{ marginBottom: 4 }}>
            {p.name} <span className="badge LEAKED">NOT CONNECTED</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Function</th>
                <th>Status</th>
                <th>What it means here</th>
              </tr>
            </thead>
            <tbody>
              {FUNCTIONS.map((f) => {
                const c = p.capabilities[f.key];
                return (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>
                      <span className={`badge ${BADGE[c.outcome].cls}`}>
                        {BADGE[c.outcome].text}
                      </span>
                      {c.unverified ? (
                        <span className="badge RUMOR" style={{ marginLeft: 4 }}>
                          unverified
                        </span>
                      ) : null}
                    </td>
                    <td style={{ fontSize: "0.85rem" }}>{c.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <details style={{ marginTop: 8 }}>
            <summary>Setup instructions (nothing here connects an account)</summary>
            <ol style={{ fontSize: "0.88rem" }}>
              {p.setupSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p style={{ fontSize: "0.85rem" }}>
              Official sources:{" "}
              {p.sources.map((s, i) => (
                <span key={s.url}>
                  {i ? " · " : ""}
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.label}
                  </a>
                </span>
              ))}
            </p>
          </details>
          <p style={{ fontSize: "0.88rem", marginTop: 6 }}>
            Manual destination:{" "}
            <a href={p.manualDestination} target="_blank" rel="noreferrer noopener">
              open {p.name} ↗
            </a>{" "}
            <span className="muted">(opens the platform; the Studio sends nothing)</span>
          </p>
        </div>
      ))}
    </div>
  );
}
