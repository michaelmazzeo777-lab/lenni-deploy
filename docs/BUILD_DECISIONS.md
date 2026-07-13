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
import) so the app builds and tests run without it installed.

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
