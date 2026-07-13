# Implementation Status

**Status:** Draft — Pending Mike Review — Live Validation Required
**Last updated:** 2026-07-13

State labels: `REALITY` = inspected/ran; `PROPOSED` = not implemented; `OPEN` = needs decision;
`APPROVAL_REQUIRED` = Mike must approve the exact action.

## Verification — REALITY (commands actually run on the build machine)

All commands run from the repository root with a local PostgreSQL 16 instance.

| Check                    | Command                                  | Result                                                                        |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Install                  | `pnpm install`                           | PASS                                                                          |
| Format                   | `pnpm format:check`                      | PASS (Prettier, all files)                                                    |
| Lint                     | `pnpm lint`                              | PASS (ESLint 9, next config)                                                  |
| Types                    | `pnpm typecheck`                         | PASS (`tsc --noEmit`, strict + noUncheckedIndexedAccess)                      |
| Migrations               | `prisma migrate deploy` (dev + test DBs) | PASS (1 migration incl. constraint SQL)                                       |
| Seed                     | `pnpm db:seed`                           | PASS (8 users, 12 content, 3 sources, 7 claims, 2 revisions, 45 audit events) |
| Unit + integration tests | `pnpm test`                              | PASS — 30/30 (5 files)                                                        |
| Secret scan              | `pnpm test:secrets`                      | PASS — clean across 74 files                                                  |
| Production build         | `pnpm build`                             | PASS — 17 routes, no DB required at build                                     |
| Browser e2e              | `pnpm test:e2e`                          | PASS — 2/2 (Chromium)                                                         |
| Full chain               | `pnpm verify`                            | PASS                                                                          |

Notes:

- Integration tests exercise the real domain services against `fieldguide_test`.
- The e2e suite launches a production `next start` server and drives the full primary path in
  a real Chromium (the environment's pre-installed build 1194; pointed at via
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- Two benign `DomainError: Sign in required` lines are logged by the server during the
  anonymous-access test; the redirect to `/signin` still occurs and the test passes.

## Primary browser workflow (docs/spec/11 section H) — REALITY

`tests/e2e/primary-workflow.spec.ts` performs, in one browser session: sign in → register
source → create CONFIRMED claim → review claim → create content → link claim → generate mock
AI packet (VALID) + record review → save script version → add asset + rights review → add
title + thumbnail → grant all 5 approvals → publish → view the public guide (heading,
classification key, disclaimer) → record a correction → verify audit actions. All steps pass.

## Feature coverage

### Implemented and tested — REALITY

- Auth: local sign-in/out, hashed passwords, server-side sessions, `/studio` guarded.
- RBAC: central capability matrix + approval-scope matrix, enforced in domain services
  (server-side), unit-tested and authorization-integration-tested.
- Data model + migration with DB-enforced invariants: append-only `AuditEvent` (UPDATE/DELETE
  blocked by trigger), immutable `PublicArticleRevision` (trigger), LEAKED claim CHECK,
  LEAKED-to-content link block (trigger), approval-hash CHECK, published-needs-URL CHECK.
- Sources & claims (all 7 classifications), CONFIRMED-needs-official-source rule, LEAKED
  auto-quarantine + containment.
- Content workflow state machine with per-transition guards and Owner-override-with-reason.
- Scripts (versioned; new version invalidates approvals).
- Assets + rights review with prohibited-use flags forcing a block; rights blockers gate READY.
- Packaging (title/thumbnail variants with deception/trademark checks).
- AI: `AIProvider` interface, deterministic mock, optional Anthropic provider, content-packet
  Zod schema, validation pipeline (invented-ID quarantine, LEAKED reference block, affiliation/
  leak language scan, uncited-section flagging), prompt-injection containment, human review.
- Approvals: scoped grants, supersede-on-regrant, invalidation on material change, READY
  readiness evaluation.
- Publication: immutable revisions, idempotent publish, PUBLISHED transition + audit.
- Corrections: records + issues a new immutable public revision + creates an update task.
- Public site: home, official facts, guides index, article page (JSON-LD, canonical, OG,
  classification key, source references, disclaimer, spoiler + last-verified), methodology,
  corrections, about/disclaimer, `robots` (draft-safe), dynamic `sitemap`.
- Audit: global and per-content timelines.
- Seed: 3 pilot videos + 9 Shorts, sources, claims incl. blocked LEAKED, variants, one
  correction, one analytics snapshot, one published guide, one blocked leaked asset.

### Partial / simplified — PROPOSED to deepen in Phase 2

- Studio navigation surfaces the core screens (dashboard, backlog, sources, claims, content
  detail with 10 tabs, audit). Calendar, kanban board, dedicated conflicts/stale views,
  analytics dashboards, packaging experiments, prompt-template admin, and role-management UI
  are **not yet built as separate screens** (data model and audit support exist).
- Analytics snapshots are stored/seeded but have no interpretation UI yet.
- `ContentBrief`, `UpdateTask`, `ContentRelation` exist in the schema and are written by seed/
  corrections, but have limited dedicated UI.
- Anthropic provider is implemented behind the interface but **not exercised** (no key; mock
  is used). `APPROVAL_REQUIRED` before any real key/spend.

### Not done / out of scope this slice

- YouTube/Google/newsletter/storage/analytics integrations — **disabled by design**;
  `APPROVAL_REQUIRED`.
- Production deployment/hosting/auth provider — `OPEN` / `APPROVAL_REQUIRED`.
- Import/export (CSV/JSON) — `PROPOSED` (Phase 2).

## Acceptance-test mapping (docs/spec/11)

Covered by automated tests (unit `U`, integration `I`, e2e `E`) or by build/CI checks `B`:
A1–A8 `B`; B9–B15 `E`,`I`,`U`; C16,C22 `I`,`U`; D25–D33 `U`,`I`; E34–E41 `I`; F42,F43,F46
`I` (flags), rights-block `I`; G49–G60 `E`,`B`; H61–H74 `E`; I78 `I`. Items not individually
automated (e.g. some rights-flag UI paths, SEO detail assertions) are supported in code and
`HUMAN_VALIDATION_REQUIRED` for full sign-off.

## Risks

- **Rights/policy:** the app assists rights review but makes **no** copyright/fair-use
  conclusions; blocks are product controls, not legal advice.
- **AI accuracy:** mock output is deterministic and grounded; a real provider would require the
  validation pipeline plus human review (both present) and spend limits (`APPROVAL_REQUIRED`).
- **Auth:** local credential adapter is for development only; production auth is `OPEN`.
- **Browser build pinning:** e2e depends on the environment's Chromium path; documented above.

## Actions still requiring Mike's approval

Public brand/name, repository/hosting, production auth provider, Anthropic key + spend limit,
any YouTube/Google/newsletter/storage connection, contact with Take-Two/legal, and any public
deployment or publication. All remain **APPROVAL_REQUIRED**.
