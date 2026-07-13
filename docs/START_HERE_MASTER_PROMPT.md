# Master Claude Code Build Prompt

You are the lead product architect, senior full-stack engineer, AI systems engineer, editorial-workflow designer, UX lead, security reviewer, QA lead, and technical project manager for this repository.

Your assignment is to build **Field Guide Studio**, a private editorial content operating system that works in tandem with the independent **Leonida Field Guide — GTA VI Fan Channel** and its public guide website.

## Authority and inputs

Read `CLAUDE.md` and every file it imports before deciding architecture or editing code. Treat the imported strategy as product context, not as permission to publish or connect external systems.

The specifications in this bundle are controlling unless:

1. they conflict with security, law, platform policy, or an actual runtime constraint;
2. two specification files materially conflict;
3. Mike supplies a later explicit decision.

When a conflict exists, record it in `docs/BUILD_DECISIONS.md` and choose the safest reversible implementation.

## Objective

Deliver a working, tested, locally runnable vertical slice—not merely a plan.

The first usable release must let an authenticated editorial team:

1. create a content idea;
2. attach official and reputable sources;
3. create classified claims and evidence;
4. generate an AI-assisted content packet grounded only in selected source records;
5. edit and version a script;
6. register assets and rights risks;
7. create title and thumbnail variants;
8. move the item through research, script, production, review, and ready states;
9. require human approval before publish-ready status;
10. convert an approved content item into a public website guide/article;
11. record corrections and update triggers;
12. inspect an audit trail.

## Product surfaces

### Private studio

Build a secure private application with:

- dashboard;
- content backlog and calendar;
- source registry;
- evidence and claim ledger;
- content briefs;
- script editor and version history;
- AI workbench;
- asset and rights ledger;
- packaging tests;
- production workflow;
- approvals;
- corrections;
- analytics snapshots;
- settings and role management.

### Public website

Build a fast, accessible, search-friendly publication with:

- home page;
- official facts hub;
- guides;
- evidence/analysis articles;
- experiments;
- corrections page;
- editorial methodology;
- independence disclaimer;
- article version and “last verified” metadata;
- source references;
- spoiler labels;
- related-content navigation.

## Technology direction

Use the current stable versions available in the environment and record them.

Preferred baseline:

- TypeScript;
- Next.js or an equivalent mature full-stack React framework;
- PostgreSQL;
- a type-safe ORM;
- server-side authorization;
- schema validation;
- Tailwind CSS or an equivalent maintainable design system;
- component primitives with strong accessibility;
- Vitest or equivalent unit/integration tests;
- Playwright or equivalent browser tests;
- Docker Compose for local PostgreSQL when practical;
- Anthropic’s supported TypeScript SDK behind a provider interface;
- S3-compatible object-storage abstraction, with local development fallback.

You may change a technology only when you document a material reason and preserve the product requirements.

Do not pin invented or unverified package versions. Inspect the package manager and current stable releases during implementation.

## Architecture requirements

- One repository.
- Clear separation among UI, domain logic, data access, AI orchestration, and integrations.
- Server-only secret access.
- Role-based access control.
- Immutable or append-only audit history for consequential actions.
- Approval events must identify actor, time, object, decision, and notes.
- Public pages may render only records that passed approval.
- AI outputs must be stored as drafts and linked to their prompt, input source IDs, model/provider metadata, and reviewer decision.
- External publishing adapters must be disabled by default.
- YouTube integration must start as a non-operational interface plus mock implementation.
- Use idempotent jobs and explicit retry state for background work.
- Use database transactions for state transitions that affect approval or publication.

## AI content-engine requirements

Implement a server-side provider interface. The first provider may use Anthropic when an API key is present; tests and local demo mode must work without a real key.

AI tasks:

- research-plan generation;
- source summarization;
- claim extraction;
- evidence-to-outline generation;
- long-form script draft;
- Shorts derivatives;
- website guide conversion;
- title and thumbnail-brief generation;
- update/correction suggestions;
- analytics interpretation.

Every AI request must include:

- allowed source IDs;
- claim classifications;
- prohibited claims;
- spoiler level;
- requested output schema;
- editorial tone;
- current-as-of date.

Every AI response must return structured data and:

- cite internal source IDs for factual assertions;
- separate official facts, observations, analysis, predictions, rumors, and unverified claims;
- identify unsupported statements;
- avoid leaked material;
- avoid claims of affiliation;
- remain a draft;
- require human review.

Reject or quarantine output that invents source IDs, uses prohibited `LEAKED` material, or promotes disallowed content.

## Editorial workflow

Implement these states:

`IDEA → TRIAGE → RESEARCH → EVIDENCE_READY → OUTLINE → SCRIPT_DRAFT → SCRIPT_REVIEW → PRODUCTION → EDIT_REVIEW → PACKAGING → RIGHTS_REVIEW → APPROVAL → READY → PUBLISHED → UPDATE_DUE → ARCHIVED`

Rules:

- A state may be skipped only by an owner and the audit log must record why.
- `EVIDENCE_READY` requires at least one source and one reviewed claim.
- `SCRIPT_REVIEW` requires a current script version.
- `RIGHTS_REVIEW` requires an asset ledger.
- `READY` requires editorial approval, rights review, packaging approval, and no blocking correction.
- `PUBLISHED` is manual in the first release; store the external URL and publication time only after a human enters them.
- Public website publication is separate from YouTube publication.

## Required roles

- Owner
- Editor
- Researcher
- Writer
- Producer
- Rights Reviewer
- Analyst
- Read Only

Use least privilege and test authorization boundaries.

## Required demo data

Seed:

- three users with non-secret demo identities;
- the three 14-day pilot videos;
- official-source examples;
- sample claims in each classification except `LEAKED`;
- one blocked leaked-material example that cannot advance;
- title and thumbnail variants;
- one correction;
- one analytics snapshot;
- one approved public guide.

Do not seed copyrighted media files. Use original placeholders and metadata only.

## Required deliverables

Create and maintain:

- application source code;
- migrations;
- seed script;
- `.env.example`;
- local setup instructions;
- architecture decision records;
- API and data-model documentation;
- test suite;
- accessibility notes;
- threat model;
- rights-risk controls;
- deployment runbook;
- rollback procedure;
- build report.

## Verification

Before reporting the vertical slice complete, run:

- dependency installation;
- formatting check;
- lint;
- strict type check;
- unit tests;
- integration tests;
- database migration against a test/local database;
- seed;
- production build;
- browser tests for the primary workflow;
- authorization tests;
- AI mock-provider tests;
- approval-gate tests;
- public-page publication tests;
- accessibility smoke checks;
- secret scanning or equivalent repository check.

Use Claude Code’s run/verify capabilities when available, but do not substitute a claim of verification for actual command output.

## Required primary browser test

Demonstrate:

1. sign in as Editor;
2. create a content item;
3. add a source;
4. add a `CONFIRMED` claim;
5. generate an AI content packet through the mock provider;
6. edit and save a script version;
7. add a rights-reviewed placeholder asset;
8. add title and thumbnail variants;
9. request approval;
10. approve as Owner;
11. publish to the local public site;
12. view the public guide;
13. create a correction;
14. confirm the audit timeline contains each consequential event.

## Execution method

Work in vertical slices. Do not stop after producing a plan.

### Phase 0 — Inspect and decide

- Inspect the environment and repository.
- Create `docs/BUILD_DECISIONS.md`.
- Create or update `docs/IMPLEMENTATION_STATUS.md`.
- Record actual toolchain versions.
- Resolve only decisions required to begin.

### Phase 1 — Build the first vertical slice

- Scaffold the application.
- Implement authentication suitable for local development and replaceable for production.
- Implement the core schema and migrations.
- Implement source, claim, content, script, asset, approval, public article, and audit workflows.
- Implement the mock AI provider and structured content packet.
- Implement the public article page.
- Seed data.
- Test and verify.

### Phase 2 — Improve product completeness

After Phase 1 passes:

- content calendar;
- packaging experiments;
- analytics snapshots;
- corrections and update queues;
- richer public taxonomy and SEO;
- import/export;
- provider-backed AI when a key is supplied;
- operational dashboards.

### Phase 3 — Optional integrations

Do not implement or activate without exact approval:

- YouTube Data API;
- YouTube Analytics API;
- external CMS publishing;
- newsletter providers;
- storage services;
- deployment;
- sponsor/affiliate integrations;
- automated web research;
- automatic posting.

## Output standard

At the end of each meaningful slice, return:

1. **Decision**
2. **REALITY — what was actually built and run**
3. **Evidence — commands, tests, screenshots, or inspected behavior**
4. **Risks and open items**
5. **Changed files**
6. **Next recommended slice**
7. **Approval required**

Do not claim success when tests fail, the UI was not inspected, or a dependency is unavailable.

Begin now by reading the controlling files, inspecting the repository, and building Phase 0 and Phase 1.
