# Threat Model

**Status:** Draft — Pending Mike Review. Scope: the local/staging MVP.

Prioritized from `docs/spec/03`. Each item lists the control implemented in this build.

| Threat                                     | Control (REALITY)                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broken access control                      | Central RBAC (`lib/permissions.ts`) enforced **inside domain services**, not just UI. `/studio` guarded server-side. Authorization integration tests assert Read Only, Researcher, Rights Reviewer, and Editor boundaries, including direct (non-UI) service calls. |
| Approval bypass / unauthorized publication | Publishing is Owner-only and requires all required-scope approvals valid against the current revision hash + no rights blockers + no blocking correction (`evaluateReadyReadiness`). READY is DB- and service-gated.                                                |
| AI prompt injection via sources            | Source text is wrapped as untrusted `<<UNTRUSTED_DATA>>`, sanitized (markup stripped, length-capped), and the system prompt instructs the model to ignore embedded instructions. The AI has **no tools** and no secret access.                                      |
| Data exfiltration via prompts              | Only selected source/claim records are sent; no secrets or unrelated data are included; provider is server-side only.                                                                                                                                               |
| Invented / prohibited AI output            | Validation pipeline rejects invented source/claim IDs (quarantine), blocks LEAKED references, scans for affiliation/leak language, and flags uncited factual sections. Output is always a draft requiring human review.                                             |
| Stored XSS in scripts/articles             | Article bodies render through a **safe markdown subset** that returns React nodes (all text escaped); no `dangerouslySetInnerHTML` for user/AI content. JSON-LD is the only serialized script and contains only server-derived fields.                              |
| Secret exposure                            | `.env` is gitignored; `.env.example` holds names/placeholders only; AI/session secrets are server-only; `pnpm test:secrets` scans tracked + untracked files in CI.                                                                                                  |
| Tamper with audit/history                  | `AuditEvent` UPDATE/DELETE blocked by DB trigger (append-only). `PublicArticleRevision` UPDATE/DELETE blocked by DB trigger (immutable snapshots). Verified by integration tests.                                                                                   |
| LEAKED material entering publication       | `Claim` CHECK forces LEAKED→QUARANTINED; a trigger blocks linking LEAKED claims to content; AI validation blocks LEAKED references; asset `flagLeaked` forces a rights block.                                                                                       |
| IDOR                                       | All studio reads/writes are scoped by `workspaceId` from the authenticated actor; unknown/out-of-workspace IDs return `NOT_FOUND` without detail.                                                                                                                   |
| Destructive migrations                     | Migrations are committed and applied explicitly; `prisma migrate deploy` is manual; `.claude/settings.json` denies `prisma migrate deploy` auto-runs and destructive shell.                                                                                         |
| Unbounded AI cost                          | Mock is default and free; provider selection is server-side; `AI_ENABLED=false` is an owner kill switch; source length is capped. Per-user rate limits are `PROPOSED` for Phase 2.                                                                                  |
| Draft content indexed publicly             | Only content with a PUBLISHED public-website publication is routable; `robots` disallows all unless `PUBLIC_SITE_INDEXABLE=true`; sitemap includes only published articles.                                                                                         |
| Dependency/supply-chain                    | Versions pinned via `pnpm-lock.yaml`; build scripts allow-listed (`onlyBuiltDependencies`). Ongoing auditing is `PROPOSED`.                                                                                                                                         |

## Residual risk / open items

- Production authentication provider is `OPEN` (local credential adapter is dev-only).
- Real AI provider spend controls and per-user quotas are `PROPOSED` / `APPROVAL_REQUIRED`.
- Full CSRF hardening beyond same-site cookies + server actions is `PROPOSED` for production.
