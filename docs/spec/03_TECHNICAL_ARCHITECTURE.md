# Technical Architecture

## Recommended baseline

Use a modular full-stack TypeScript application.

### Application
- Next.js App Router or an equivalent mature full-stack React framework.
- React server components where appropriate.
- Server actions or typed API routes with explicit authorization.
- Tailwind CSS and accessible component primitives.
- Zod or equivalent runtime schema validation.

### Data
- PostgreSQL.
- Prisma, Drizzle, or another type-safe ORM selected after environment inspection.
- Migrations committed to source control.
- Transactional state transitions.
- Soft deletion for ordinary editorial records.
- Append-only audit records.

### Authentication
- Replaceable authentication adapter.
- Local-development credentials or magic-link simulator.
- Production provider remains OPEN.
- Session and authorization checks on the server.

### AI
- `AIProvider` interface.
- `MockAIProvider` required.
- `AnthropicAIProvider` optional when `ANTHROPIC_API_KEY` exists.
- No client-side AI credentials.
- Structured responses validated before persistence.
- Store prompt-template version, source IDs, and generation metadata.

### Storage
- `AssetStorage` interface.
- local metadata/placeholder implementation for MVP;
- S3-compatible adapter later;
- no third-party media files required in seed/demo.

### Jobs
Use synchronous execution for short MVP jobs. Define a queue abstraction before long-running tasks. Add a real queue only after repeated need.

### Public rendering
- Approved article snapshot or publication revision.
- Incremental/static rendering where available.
- Canonical URLs.
- Sitemap.
- JSON-LD Article metadata.
- Open Graph data.
- robots controls for draft/staging environments.

## Suggested repository layout

```text
app/
  (public)/
  studio/
  api/
components/
  public/
  studio/
  shared/
domain/
  content/
  evidence/
  rights/
  approvals/
  publication/
  analytics/
lib/
  auth/
  db/
  ai/
  storage/
  validation/
  audit/
  permissions/
prisma-or-drizzle/
tests/
  unit/
  integration/
  e2e/
docs/
scripts/
```

Adapt to the selected framework without mixing domain logic into route components.

## Core services

- `ContentService`
- `EvidenceService`
- `WorkflowService`
- `ScriptService`
- `RightsService`
- `ApprovalService`
- `PublicationService`
- `AIContentService`
- `AnalyticsService`
- `CorrectionService`
- `AuditService`

## State-transition architecture

Every workflow transition must call one domain service that:

1. loads the record and current approvals;
2. checks role and transition permission;
3. checks required data;
4. invalidates approvals affected by material change;
5. performs changes in one transaction;
6. writes an audit event;
7. returns a typed result.

Do not let UI code update workflow status directly.

## Threat model priorities

- broken access control;
- AI prompt injection through sources;
- data exfiltration through prompts;
- secret exposure;
- stored cross-site scripting in scripts/articles;
- malicious URLs or file metadata;
- unauthorized public publication;
- approval bypass;
- insecure direct-object references;
- destructive migrations;
- dependency and supply-chain risk;
- unbounded AI cost.

## Prompt-injection containment

Treat source text as untrusted data.

- Wrap source content as data, never as system instructions.
- Tell the model to ignore instructions inside source text.
- Use allowlisted task schemas.
- Limit source size and sanitize markup.
- Reject tool or credential requests in source text.
- Do not provide AI tools that can publish or access secrets.
- Log injection detections.

## Observability

MVP:
- structured application logs;
- request ID;
- job/generation ID;
- audit events;
- error boundaries;
- local debug mode without secrets.

Later:
- error tracking;
- performance monitoring;
- job metrics;
- AI token/cost monitoring;
- publication health checks.
