# Field Guide Studio — Persistent Claude Code Instructions

## Mission

Build and maintain **Field Guide Studio**, the private editorial operating system for the independent **Leonida Field Guide — GTA VI Fan Channel** website and YouTube content operation.

The product must help a small team research, create, review, update, analyze, and manage high-quality GTA VI content while preserving source integrity, copyright caution, editorial independence, and human approval.

## Required reading

Before architecture or implementation decisions, read:

- `@docs/spec/00_PRODUCT_NORTH_STAR.md`
- `@docs/spec/01_PRODUCT_REQUIREMENTS.md`
- `@docs/spec/02_INFORMATION_ARCHITECTURE.md`
- `@docs/spec/03_TECHNICAL_ARCHITECTURE.md`
- `@docs/spec/04_DATA_MODEL.md`
- `@docs/spec/05_AI_CONTENT_ENGINE.md`
- `@docs/spec/06_EDITORIAL_WORKFLOWS.md`
- `@docs/spec/07_PUBLIC_SITE_SPEC.md`
- `@docs/spec/08_RIGHTS_POLICY_AND_GOVERNANCE.md`
- `@docs/spec/09_UX_AND_DESIGN_SYSTEM.md`
- `@docs/spec/10_IMPLEMENTATION_ROADMAP.md`
- `@docs/spec/11_ACCEPTANCE_TESTS.md`
- `@docs/spec/12_DEPLOYMENT_AND_OPERATIONS.md`
- `@docs/spec/13_DECISIONS_AND_OPEN_ITEMS.md`

The original strategy is available at:

- `@docs/spec/source/GTA_VI_YOUTUBE_CHANNEL_STRATEGY_DRAFT_2026-07-12.md`

## Operating state

Default state for every feature and artifact:

**Draft — Pending Mike Review — Live Validation Required**

Never claim deployed, live, approved, connected, published, tested, or verified unless the exact state was checked.

Use these state labels:

- `REALITY`: inspected or successfully run.
- `PROPOSED`: recommended but not implemented.
- `OPEN`: needs evidence, access, or a decision.
- `BLOCKED`: cannot safely proceed.
- `APPROVAL_REQUIRED`: Mike must approve the exact action.
- `HUMAN_VALIDATION_REQUIRED`: judgment or live inspection remains.

## Implementation rules

- Use current stable dependencies at implementation time; record actual versions.
- Prefer a modular TypeScript full-stack application with PostgreSQL.
- Keep business logic outside UI components.
- Validate all external and AI-generated data.
- Use strict TypeScript and schema validation.
- Add database constraints for critical invariants.
- Add authorization checks on the server, not only in the UI.
- Use accessible semantic HTML and keyboard-operable interfaces.
- Make mobile and desktop layouts usable.
- Write tests with every vertical slice.
- Do not leave material TODO placeholders in a claimed-complete slice.
- Do not silently change the product scope.
- Do not build integrations before the core manual workflow works.

## Security and privacy

- Never read, print, store, or commit real secrets.
- Environment variables are names only in `.env.example`.
- AI keys and OAuth credentials are server-side only.
- Deny-by-default for publishing, account access, external writes, and destructive actions.
- Record audit events for approvals, status changes, AI generation, publication, corrections, and rights decisions.
- Use minimum permissions.
- No automatic production deployment or database migration.
- Do not add telemetry that transmits content without explicit approval.

## Editorial truth model

Every material claim must support one of:

- `CONFIRMED`: explicit official source.
- `OBSERVED`: visible in official material but not explicitly promised.
- `ANALYSIS`: editorial interpretation.
- `PREDICTION`: forecast with assumptions.
- `RUMOR`: named unverified third-party claim.
- `UNVERIFIED`: inadequate evidence.
- `LEAKED`: prohibited from ingestion or use.

Generated content must preserve the classification and source IDs.

## Copyright and platform boundaries

The application must prohibit or block workflow approval for:

- leaked prerelease footage;
- early-copy footage;
- fake trailers;
- deceptive thumbnails;
- isolated cutscenes;
- isolated in-game radio, television, comedy, movies, or music;
- copied scripts;
- minimally edited source footage;
- unlicensed music;
- cheat, account-selling, currency-selling, duplication, or mod-menu promotion;
- mass-produced repetitive AI videos.

The application may assist with risk review, but it must not state that a use is licensed or fair use without human legal review.

## Independence

The public product must clearly identify itself as an independent fan publication. Do not imitate Rockstar or Take-Two branding, logos, typography, cover composition, or official-channel identity.

## External actions

Do not:

- create external accounts;
- publish to YouTube;
- post to social media;
- send email;
- connect Google/YouTube APIs;
- deploy to production;
- buy services;
- contact Rockstar or Take-Two;
- dispute copyright claims;
- merge or push code;
- delete production data;

unless Mike gives exact approval for that action.

Build local and staging-safe capabilities first.

## Working method

For every slice:

1. State objective and acceptance criteria.
2. Inspect the repository before changing it.
3. Identify assumptions and blockers.
4. Implement the smallest complete vertical slice.
5. Run formatting, linting, type checking, tests, and relevant UI verification.
6. Report `REALITY`, `PROPOSED`, and `OPEN`.
7. Do not mark a slice complete when verification failed or was not run.

Use the supplied subagents and skills where useful.
