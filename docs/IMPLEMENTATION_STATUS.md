# Implementation Status

**Status:** Draft — Pending Mike Review — Live Validation Required
**Last updated:** 2026-07-13

State labels: `REALITY` = inspected/ran; `PROPOSED` = not implemented; `OPEN` = needs decision;
`APPROVAL_REQUIRED` = Mike must approve the exact action.

## Verification — REALITY (commands actually run on the build machine)

All commands run from the repository root with a local PostgreSQL 16 instance.

| Check                    | Command                                  | Result                                                                                                                                           |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install                  | `pnpm install`                           | PASS                                                                                                                                             |
| Format                   | `pnpm format:check`                      | PASS (Prettier, all files)                                                                                                                       |
| Lint                     | `pnpm lint`                              | PASS (ESLint 9, next config)                                                                                                                     |
| Types                    | `pnpm typecheck`                         | PASS (`tsc --noEmit`, strict + noUncheckedIndexedAccess)                                                                                         |
| Migrations               | `prisma migrate deploy` (dev + test DBs) | PASS — 3 migrations (init incl. constraint SQL; packaging_experiment; distributed_production incl. AI-not-real-gameplay + leaked-capture CHECKs) |
| Seed                     | `pnpm db:seed`                           | PASS (12 users incl. contributor roles, 12 content, 3 sources, 7 claims, 2 revisions, 61 audit events)                                           |
| Unit + integration tests | `pnpm test`                              | PASS — 52/52 (9 files)                                                                                                                           |
| Secret scan              | `pnpm test:secrets`                      | PASS — clean (all tracked + untracked files)                                                                                                     |
| Production build         | `pnpm build`                             | PASS — 27 routes, no DB required at build                                                                                                        |
| Browser e2e              | `pnpm test:e2e`                          | PASS — 4/4 (Chromium)                                                                                                                            |
| Full chain               | `pnpm verify`                            | PASS                                                                                                                                             |

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

### Growth & Administration slice (added after Phase 1) — REALITY

- **Production board** (`/studio/board`): content grouped into workflow-state columns.
- **Update queue & stale evidence** (`/studio/updates`): open update tasks with resolve action;
  flagging a source stale opens deduplicated update tasks for every reliant content item
  (`markSourceStale` / `resolveUpdateTask`). Integration-tested.
- **Analytics** (`/studio/analytics`): manual snapshot import + heuristic scorecard signals
  (CTR / hook / depth) with good/watch/weak grading. Unit + integration tested.
- **Users & roles** (`/studio/admin/roles`, Owner-only): assign/remove roles with a
  last-Owner-protection guard and audit. Integration-tested.
- **Export** (`/studio/export/{claims|sources|content|audit}?format=csv|json`): workspace-scoped,
  no secrets; used by an e2e assertion.
- **Content calendar** (`/studio/calendar`): items grouped into overdue / due-this-week / later by
  due date; seed assigns pilot due dates.
- **Packaging A/B experiments** (packaging tab): compare two title variants, then record a
  measured result (supported / contradicted / inconclusive) separated from the interpretation;
  a `PackagingExperiment` model + migration was added. Integration-tested; seeded example.

### Distributed production slice (Contributor, Gameplay, Visual Production Manager) — REALITY

- **Roles**: CONTRIBUTOR, NARRATOR, VIDEO_EDITOR, DESIGNER added; restricted contributors
  may act only on their own assignments (`assertAssignmentAccess`, `listAssignmentsFor`).
- **Contributors & assignments** (`/studio/contributors`): profiles (no payment/identity
  data), 9 assignment kinds, submit → review (approve / revision / reject), rights-release
  tracking; a submitted deliverable without a received release is a rights blocker.
- **Gameplay production** (Production tab): ordered shot lists; capture sessions with
  platform, version, settings, trials, HUD, licensed-music, mods declaration, file refs;
  submit → retake-with-notes → replacement (supersedes) → approve; leaked-flagged footage is
  auto-BLOCKED (DB CHECK) and can never be approved.
- **Production handoff** (`/studio/handoff/[contentId]?format=md|json`): Markdown/JSON packet
  with brief, script, shot list, approved captures/visuals, assignments, packaging, music
  restrictions, rights notes, export checklist. Download only — never sent externally.
- **Visual Production Manager** (Visuals tab): provider-neutral briefs (12 kinds) →
  owner prompt+cost-ceiling approval → exported prompt packet with embedded rights
  constraints → external/mock generation → import with ACTUAL provider/model/cost →
  AI-disclosure + rights review → approve/reject/block. `MockVisualProvider` and
  `ManualVisualProvider` work with zero credentials; `HiggsfieldProvider`,
  `GeminiImageProvider`, `GeminiVideoProvider` exist but are DISABLED and throw
  (`APPROVAL_REQUIRED`); no model name, price, quota, or entitlement is assumed.
- **Containment**: DB CHECKs — AI visual can never be `presentedAsRealGameplay`; approved
  visual requires a non-BLOCKED disclosure decision; leaked capture must be BLOCKED.
  `rightsBlockers` now also gates READY on missing releases, blocked captures, and
  unreviewed/blocked visual assets.
- **Tests**: 9-test integration suite covering the full 16-step multi-role chain (owner →
  researcher → mock AI → assignment → capture → retake → replacement → visual brief →
  manual+mock import → rights approval → script → packaging → approvals → publish →
  correction → audit) plus negatives (leak block, missing release blocker, AI-as-real-gameplay
  refusal at domain AND DB level, unreviewed-visual blocker, contributor isolation, permission
  bypass attempts, idempotent duplicate import, over-ceiling cost refusal, disabled providers).
  Browser e2e verifies the seeded pipeline UI and contributor isolation.

### Partial / simplified — PROPOSED to deepen further

- Prompt-template admin and richer conflict-group views remain `PROPOSED` (data model + audit
  support exist).
- `ContentBrief` and `ContentRelation` exist in the schema with limited dedicated UI.
- Anthropic provider is implemented behind the interface but **not exercised** (no key; mock
  is used). `APPROVAL_REQUIRED` before any real key/spend.

### Not done / out of scope

- YouTube/Google/newsletter/storage/external-analytics integrations — **disabled by design**;
  `APPROVAL_REQUIRED`.
- Production deployment/hosting/auth provider — `OPEN` / `APPROVAL_REQUIRED`.

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
