# Field Guide Studio — Leonida Field Guide (GTA VI Fan Channel)

**Status: Draft — Pending Mike Review — Live Validation Required.** Local/staging only. No
external accounts, deployments, or integrations are connected.

A dual-surface content operating system for an **independent** GTA VI fan publication:

- **Field Guide Studio** — the private editorial studio (research, evidence, scripts, AI drafts,
  assets/rights, packaging, approvals, publication, corrections, audit).
- **Leonida Field Guide** — the public, server-rendered guide/evidence website, built only from
  approved, immutable article revisions.

Independent fan project. **Not affiliated with, endorsed by, or operated by Rockstar Games or
Take-Two Interactive.** No leaked material is ingested or published.

## Stack

Next.js 15 (App Router, React 19) · TypeScript (strict) · PostgreSQL + Prisma 6 · Zod ·
tokenized CSS design system · Vitest · Playwright. Exact versions: `docs/BUILD_DECISIONS.md`.

## Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16 running locally (a `fieldguide` and a `fieldguide_test` database)

## Local setup

```sh
pnpm install

cp .env.example .env
# Edit .env: set AUTH_SECRET to a long random string. DATABASE_URL/TEST_DATABASE_URL
# default to a local postgres. Leave AI_PROVIDER=mock (no API key needed).

# Create databases (if they don't exist) and apply migrations:
createdb fieldguide && createdb fieldguide_test   # or use your own tooling
pnpm exec prisma migrate deploy                    # dev DB
DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma migrate deploy  # test DB

pnpm db:seed        # demo data (3 pilots + 9 Shorts, sources, claims, one published guide)
pnpm dev            # http://localhost:3000
```

Sign in at `/signin` with a seeded demo account (password `demo-password-123`):

- `owner@leonida.test` — Owner (full capability, can approve & publish)
- `editor@leonida.test` — Editor
- `researcher@leonida.test` — Researcher
- also seeded: writer / producer / rights / analyst / readonly `@leonida.test`

The public site is at `/`. The studio is at `/studio`.

## Scripts

| Command                                    | What it does                                                       |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `pnpm dev`                                 | Run the app locally                                                |
| `pnpm build` / `pnpm start`                | Production build / serve                                           |
| `pnpm typecheck`                           | Strict TypeScript check                                            |
| `pnpm lint` / `pnpm format:check`          | ESLint / Prettier                                                  |
| `pnpm test`                                | Unit + integration tests (uses `TEST_DATABASE_URL`)                |
| `pnpm test:e2e`                            | Playwright browser tests (reseeds `fieldguide`, runs `next start`) |
| `pnpm test:secrets`                        | Repository secret scan                                             |
| `pnpm verify`                              | format + lint + types + tests + secrets + build                    |
| `pnpm db:migrate` / `db:reset` / `db:seed` | Prisma migrations / reset / seed                                   |

### Running the browser tests

The environment's pre-installed Chromium differs from Playwright's default; point at it:

```sh
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e
```

## Documentation

- `CLAUDE.md` — persistent project instructions (imports the controlling spec in `docs/spec/`).
- `docs/BUILD_DECISIONS.md` — reversible technical decisions + actual versions.
- `docs/IMPLEMENTATION_STATUS.md` — what was built and the real verification evidence.
- `docs/THREAT_MODEL.md`, `docs/DEPLOYMENT_RUNBOOK.md` — security & ops notes.
- `docs/spec/*` — the controlling product specification.

## Safety boundaries (enforced)

Server-side RBAC · append-only audit (DB trigger) · immutable public revisions (DB trigger) ·
LEAKED containment (CHECK + trigger) · approval invalidation on material edits · AI output
validation + prompt-injection containment · deny-by-default publishing · no real credentials ·
no external integrations.
