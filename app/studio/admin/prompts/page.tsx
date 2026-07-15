import { requireStudioActor } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { listPromptTemplates, PROMPT_TEMPLATE_KEYS } from "@/domain/prompts";
import { createPromptVersionAction, setPromptActiveAction } from "@/app/studio/prompt-actions";

export const metadata = { title: "Prompt templates — Field Guide Studio" };
export const dynamic = "force-dynamic";

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStudioActor();
  const { error } = await searchParams;

  if (!can(actor, "prompt.manage")) {
    return (
      <div>
        <h1>Prompt templates</h1>
        <p className="error">Only an Owner can manage prompt templates.</p>
      </div>
    );
  }

  const templates = await listPromptTemplates(actor);
  const activeByKey = new Map<string, number>();
  for (const t of templates) {
    if (t.active && !activeByKey.has(t.key)) activeByKey.set(t.key, t.version);
  }

  return (
    <div>
      <h1>Prompt templates</h1>
      <p className="muted">
        Versions are append-only: a change is always a new version, so every AI generation keeps
        pointing at exactly the text it used. Template text is <strong>appended after</strong> the
        fixed safety rules (untrusted-data containment, no leaks, no affiliation, no legal
        clearance) — it can add editorial guidance but can never remove those rules. When no version
        is active, generation uses the built-in prompt (version 0). The mock provider is
        deterministic and ignores template text; templates take effect with a real provider.
      </p>
      <Banner error={error} />

      <div className="card">
        <h2>New version</h2>
        <form action={createPromptVersionAction}>
          <label htmlFor="key">Template</label>
          <select id="key" name="key">
            {PROMPT_TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k} (next: v{(templates.find((t) => t.key === k)?.version ?? 0) + 1})
              </option>
            ))}
          </select>
          <label htmlFor="systemText">
            Editorial guidance (appended to the fixed safety rules)
          </label>
          <textarea
            id="systemText"
            name="systemText"
            rows={5}
            required
            placeholder="e.g. Prefer short declarative sentences. Open with the direct answer. Cite the claim classification inline."
          />
          <label htmlFor="userTemplate">
            Notes on user-prompt intent (optional, recorded only)
          </label>
          <textarea id="userTemplate" name="userTemplate" rows={2} />
          <label htmlFor="outputSchema">Output-schema notes (optional, recorded only)</label>
          <textarea id="outputSchema" name="outputSchema" rows={2} />
          <div style={{ marginTop: 12 }}>
            <button type="submit">Create version</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Versions</h2>
        {templates.length === 0 ? (
          <p className="muted">
            No versions yet — generation uses the built-in prompt (version 0).
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Version</th>
                <th>Status</th>
                <th>Guidance</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.key}</td>
                  <td>v{t.version}</td>
                  <td>
                    {t.active ? (
                      <span className="badge CONFIRMED">
                        {activeByKey.get(t.key) === t.version ? "ACTIVE (in use)" : "active"}
                      </span>
                    ) : (
                      <span className="badge UNVERIFIED">inactive</span>
                    )}
                  </td>
                  <td className="muted" style={{ maxWidth: 380, fontSize: "0.8rem" }}>
                    {t.systemText.length > 160 ? `${t.systemText.slice(0, 159)}…` : t.systemText}
                  </td>
                  <td className="muted" style={{ fontSize: "0.8rem" }}>
                    {t.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td>
                    <form action={setPromptActiveAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                      <button type="submit" className="secondary">
                        {t.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
