# Deployment & Rollback Runbook

**Status:** Draft — Pending Mike Review — Live Validation Required.
**No production deployment is configured or authorized.** This documents the _local/staging_
procedure and the intended production shape. Public deployment is `APPROVAL_REQUIRED`.

## Local / staging bring-up

1. Provision PostgreSQL 16; create `fieldguide` (and `fieldguide_test` for CI).
2. Set environment (see `.env.example`): `DATABASE_URL`, `AUTH_SECRET` (long random),
   `APP_BASE_URL`, `AI_PROVIDER=mock`, `PUBLIC_SITE_INDEXABLE=false`.
3. `pnpm install --frozen-lockfile`
4. `pnpm exec prisma migrate deploy` (never auto-run in CI without review).
5. `pnpm db:seed` for demo data (optional in staging).
6. `pnpm build && pnpm start`.

## Migration safety

- Migrations live in `prisma/migrations/` and are committed.
- Apply with `prisma migrate deploy` (forward-only). Review each migration's SQL first —
  the initial migration also creates triggers/constraints for append-only audit, immutable
  revisions, and LEAKED containment.
- `.claude/settings.json` denies automated `prisma migrate deploy`.

## Rollback

- **Application:** redeploy the previous build/commit. The public site reads immutable
  revisions, so rolling back code does not alter already-published article content.
- **Database:** migrations are forward-only. To reverse a schema change, write and review a new
  compensating migration; do not hand-edit applied migrations. Take a database backup before any
  migration in staging/production.
- **Content:** revisions are immutable and append-only; to "unpublish", set the `Publication`
  status to `UNPUBLISHED` (removes it from public routes) rather than deleting revisions.

## Health checks (MVP)

- App responds on `/` (public) and redirects `/studio` → `/signin` when unauthenticated.
- `pnpm verify` is green (format, lint, types, tests, secrets, build).
- Database reachable; `prisma migrate status` clean.

## Explicitly NOT part of this runbook (APPROVAL_REQUIRED)

Production hosting/provider, custom domain, external auth provider, Anthropic API key + spend
limit, YouTube/Google/newsletter/storage/analytics connections, and any public publication.
