# Build Decisions

**Status:** Draft — Pending Mike Review — Live Validation Required
**Repository:** `michaelmazzeo777-lab/lenni-deploy` · branch `claude/field-guide-studio-pot79b`

This records the reversible technical decisions taken during the build, with reasons.
Decisions that require Mike's approval before public use are listed in
`docs/spec/13_DECISIONS_AND_OPEN_ITEMS.md` and remain OPEN.

## Repository placement

**Decision:** Build Field Guide Studio in `lenni-deploy` (greenfield; only contained a
Google Apps Script). **Left `CAMEO-private-preview` untouched** — it is a separate,
pre-existing product (association tenant-isolation app), not the Leonida Field Guide.
Reason: the spec bundle is for the independent Leonida GTA VI project; `lenni-deploy`
("Lenni" ≈ Leonida) is its natural home. Building the fan-guide app inside the unrelated
CAMEO monorepo would corrupt a different product.

## Toolchain — actual versions installed

Recorded from `node_modules` on the build machine (Node v22.22.2, pnpm 10.33.0, PostgreSQL 16.13).

| Dependency              | Version |
| ----------------------- | ------- |
| next                    | 15.5.20 |
| react / react-dom       | 19.2.7  |
| typescript              | 5.9.3   |
| prisma / @prisma/client | 6.19.3  |
| zod                     | 3.25.76 |
| vitest                  | 3.2.7   |
| @playwright/test        | 1.61.1  |
| eslint                  | 9.39.5  |
| eslint-config-next      | 15.5.20 |
| prettier                | 3.9.5   |
| tsx                     | 4.19.2  |

## Framework: Next.js App Router

**Decision:** Next.js 15 App Router with React 19 Server Components and Server Actions.
Reason: the spec's preferred baseline; one codebase serves the private studio (dynamic,
authenticated) and the public site (server-rendered, SEO-friendly). Domain logic is kept
out of route components (see `domain/`).

## ORM: Prisma

**Decision:** Prisma over Drizzle. Reason: mature migration workflow, typed client,
straightforward local Postgres. Critical invariants that Prisma's schema cannot express
(append-only audit, immutable revisions, LEAKED containment, CHECK constraints) are added
as raw SQL appended to the initial migration.

## Design system: hand-authored CSS tokens (not Tailwind)

**Decision:** A single tokenized stylesheet (`app/globals.css`) with CSS custom properties,
light/dark support, semantic HTML, visible focus, and reduced-motion support — instead of a
utility framework. Reason: the spec permits "Tailwind **or an equivalent maintainable design
system**." A small tokenized CSS system removes PostCSS/Tailwind build-config risk for the MVP
while still delivering an accessible, consistent, responsive UI. Revisitable later.

## Authentication: replaceable local credential adapter

**Decision:** Local email+password sign-in with scrypt-hashed passwords and server-side,
httpOnly, hashed-token sessions (`lib/auth`). Reason: the spec requires a **replaceable**
auth adapter and local-dev credentials; production provider remains OPEN and needs Mike's
approval. No third-party auth is wired.

## AI provider: mock-first behind an interface

**Decision:** `AIProvider` interface with a deterministic `MockAIProvider` (default) and an
optional `AnthropicAIProvider` loaded via dynamic import only when `ANTHROPIC_API_KEY` is set.
Reason: the spec mandates mock-first, no client credentials, and that a missing key must not
break demo/test mode. The Anthropic SDK is an _optional_ dependency (dynamic, non-literal
import) so the app builds and tests run without it installed. The provider accepts an
injectable client factory (defaulting to the SDK import) so its request/response handling
and its flow into the validation pipeline are unit-tested against a recorded-shape fixture
— the paid path is proven up to the network boundary without a key or spend.

## Storage: metadata-only placeholder

**Decision:** Assets are metadata-only records (no file bytes, no copyrighted media) for the
MVP. An `AssetStorage`/S3 adapter is deferred (Phase 2+). Reason: the spec forbids seeding
copyrighted media and defers object storage.

## Jobs: synchronous

**Decision:** AI generation and state transitions run synchronously inside DB transactions.
Reason: MVP jobs are short; a queue abstraction is deferred until repeated need, per spec.

## Workflow transition model

**Decision:** A single `transition()` domain service enforces the linear state order; only the
immediate next step or a backward move is allowed by default, and any forward skip requires an
Owner override **with a recorded reason**. Guards check required data per target state. Reason:
matches `docs/spec/06` and keeps status changes out of UI code.

## Approval invalidation via revision hash

**Decision:** Each approval stores a SHA-256 hash of the content's material state
(title, spoiler level, current script body, claim/asset/thumbnail IDs). READY requires all
required-scope approvals whose stored hash equals the current hash; material edits change the
hash and thereby invalidate prior approvals (and are explicitly revoked + audited). Reason: a
robust, testable implementation of "material edits invalidate approvals."

## Public slug uniqueness

**Decision:** Public article slugs are globally unique; a collision with a different content
item is disambiguated with a stable id suffix. Reason: `PublicArticleRevision` enforces
`unique(slug, revision)`; two items must not share a public URL.

## Test databases

**Decision:** Integration tests run against a dedicated `fieldguide_test` database; each test
creates an isolated workspace so files can share the DB. Playwright reseeds `fieldguide` in a
global setup and runs against a production `next start` server.

## Shorts pipeline: mock-first, human-gated, Mike-footage-only (2026-07-16)

**Decision:** Implemented slice 1 of `docs/YOUTUBE_SHORTS_PIPELINE_BLUEPRINT.md` with Mike's
explicit approval of the full build and his clarification that all footage is Mike/team-provided.
Key choices: (a) footage intake **reuses** the existing `CaptureSession` review flow (new
`targetsShorts` flag; leaked footage remains auto-BLOCKED) rather than any open public intake;
(b) all four providers (script CV/LLM, TTS, video compositor, YouTube publisher) are
deterministic mocks by default behind `lib/shorts/` seams — a non-mock selection without
credentials **fails loudly** rather than silently falling back, and the mock publisher returns
`mock-`-prefixed IDs that can never be mistaken for a real upload; (c) safety-flagged scripts
are QUARANTINED for human review, never auto-passed or silently filtered; (d) renders land
PENDING and require a human Approve/Reject (reusing `capture.review` authority) before publish;
(e) publish is a new Owner-only capability `shorts.publish`, mirroring `publication.publish`,
with synthetic-content disclosure flags always included in the payload; (f) 30fps default
(cost decision, see blueprint §8). Real YouTube/TTS/render connections remain
`APPROVAL_REQUIRED` + credentials-gated; nothing external is contacted today.

## Studio visual theme: neon-noir, Studio-only (2026-07-16)

**Decision:** Applied a dark "neon-noir" theme (teal/cyan + magenta on near-black, `.studio-theme`
in `app/globals.css`) to the private Studio tool only — public site and sign-in page are
byte-for-byte unaffected (they never receive the class). Mike's explicit direction. Palette is
the 1980s Miami neon-noir genre style, a public-domain aesthetic (Miami Vice predates and is
unrelated to Rockstar's IP) — deliberately **not** any imitation of Rockstar/Take-Two's actual
GTA VI marketing type, logo, or trade dress, which CLAUDE.md prohibits. Competitor research
(GTA fan-channel thumbnails using the official "VI" logo and photorealistic character crops)
was reviewed and explicitly rejected as a direction for exactly that reason.

Button fills use dark saturated tones (cyan-800/fuchsia-800) rather than the brighter neon
tones, so white button text keeps strong contrast (measured 7.27:1 and 8.24:1, both exceeding
even the AAA 7:1 threshold); the brighter cyan/magenta values are used only for glows, borders,
links, and the gradient-text brand wordmark against the dark background, which independently
measure 10.68:1 and 7.29:1. All values measured with the WCAG relative-luminance formula, not
assumed. The Studio now ships one fixed dark theme regardless of the visitor's OS light/dark
preference (declared directly on the `.shell` element, which overrides inherited `:root`
tokens) — the same choice most professional creative tools make (Figma, Linear, code editors);
the public site is unaffected and continues to respect the visitor's preference as before.
Token-only CSS change; no new dependencies; verified with the full test suite (unchanged) plus
the full e2e suite (unchanged) plus manual before/after screenshots.

## Adversarial-audit hardening (2026-07-15)

Findings confirmed by direct code inspection and repaired the same day:

1. **JSON-LD stored XSS** (`app/(public)/guides/[slug]/page.tsx`): `JSON.stringify` does not
   escape `</script>`, so a published title containing markup could break out of the
   structured-data script element. Fixed by encoding `<` as `<`.
2. **Server-action body limit contradiction**: Next's 1 MB default killed 1–10 MiB uploads in
   the framework before the app's documented 10 MiB validation ever ran. Fixed with
   `serverActions.bodySizeLimit: "11mb"`; proven by the storage e2e now uploading a real 2 MB
   file end-to-end.
3. **Missing CSP / Permissions-Policy**: added a same-origin-locked Content-Security-Policy
   (`'unsafe-inline'` only where Next's inline bootstrap and the app's inline styles require
   it) and a deny-all Permissions-Policy. Headers verified live with curl; all e2e pass under
   the CSP.
4. **Unbounded content-list query**: bounded with `take: 500`.

Verified clean in the same audit: session lifecycle (hashed 32-byte tokens, httpOnly/secure
cookie, server-side expiry + sign-out invalidation, fresh token per sign-in), authorization
coverage (41/41 studio server actions resolve the actor and delegate to RBAC- and
workspace-checked domain services; the 2 unguarded actions are sign-in/out by design), raw
SQL (only the seed truncate with a hardcoded list), markdown rendering (React-node renderer,
all text escaped), public publish gating (central `PUBLISHED`-only reads; official-facts
excludes LEAKED), storage path escapes (tested). Accepted, documented risks: throttle
counter race can under-count by one under exact concurrency (fail-safe direction);
prompt-version race fails safe via the unique constraint; `x-forwarded-for` spoofing
weakens only the IP ceiling.

## Sign-in throttling: DB-backed fixed window, dual key

**Decision:** Brute-force protection is a `SignInThrottle` table keyed per email
(5 failures / 15 min) and per client IP (20 failures / 15 min, higher because IPs are
shared), locking the key for 15 minutes. DB-backed (not in-memory) so it survives restarts
and works across instances; checked before password verification and for nonexistent
accounts identically, so lockout behavior does not reveal account existence. Success clears
the email counter only — the IP window keeps counting so a rotating-password attack from one
address still hits the IP ceiling. Lockouts on known accounts are audited (`auth.lockout`,
actor SYSTEM). The IP comes from the first `x-forwarded-for` hop; spoofing it only weakens
the IP ceiling, never the email ceiling.

## Prompt templates: append-only versions, safety rules fixed in code

**Decision:** `PromptTemplate` is workspace-scoped with append-only versioning — a change is
always a new row (never edit/delete), so `AIGeneration.promptTemplateVersion` permanently
points at exactly the text used; version 0 means the built-in code prompt. The template's
`systemText` is **appended after** the fixed safety rules in `lib/ai/prompt.ts` (untrusted-data
containment, no leaks, no affiliation, no legal claims) and can never replace them — an
editable DB row must not be able to remove governance rules. Managing templates is an
Owner-only capability (`prompt.manage`); creation/activation/deactivation are audited.
Deactivating the newest version is the rollback path. The mock provider is deterministic and
ignores template text; templates take effect with a real provider.

## Local file storage: quarantine-first, image-only for MVP

**Decision:** `AssetStorage` is a small provider-neutral interface (`lib/storage/types.ts`)
backed today by `LocalAssetStorage`, which writes real bytes under a gitignored
`STORAGE_ROOT` (default `./.data/storage`) with path-escape rejection. Uploaded files always
land in a quarantine path first; a deterministic mock content scan (`domain/storage.ts`) must
pass before the file is moved to a clean path and the owning `Asset`/`VisualAsset` record's
`location` is updated. Reason: matches the spec's "AssetStorage interface; local
metadata/placeholder implementation for MVP; S3-compatible adapter later," while adding a real
quarantine gate so an unreviewed or rejected upload can never silently become an approved
asset's location. Scope is deliberately narrowed to image files (png/jpg/jpeg/webp/gif, ≤10 MiB)
for this slice — gameplay capture video remains a `fileReference` string (external storage),
since browser-uploading multi-gigabyte footage through this app is out of scope for the MVP.
