# Implementation Roadmap

## Phase 0 — Repository and decisions

### Deliver
- inspected environment;
- actual versions;
- package manager choice;
- architecture decision record;
- local run strategy;
- implementation status file.

### Done
- project starts;
- formatter/linter/type checker configured;
- test runner configured;
- no real secrets.

## Phase 1 — Foundational vertical slice

### Deliver
- local authentication;
- roles and authorization;
- PostgreSQL schema;
- migrations and seed;
- source registry;
- claims;
- content item;
- script versions;
- asset and rights review;
- approvals;
- audit log;
- mock AI content packet;
- approved public article;
- primary browser test.

### Done
- full primary workflow passes;
- production build succeeds;
- public article cannot exist without approval;
- blocked leaked item cannot progress.

## Phase 2 — Editorial completeness

- backlog/kanban/calendar;
- research packets;
- comments;
- packaging variants;
- correction workflow;
- stale-evidence queue;
- exports;
- richer public taxonomies;
- SEO metadata.

## Phase 3 — Growth operations

- manual analytics import;
- scorecards;
- continuation/pivot thresholds;
- content clusters;
- title/thumbnail experiment records;
- monetization scenario planner;
- newsletter content drafts.

## Phase 4 — AI provider

After manual/mock workflow passes:

- Anthropic provider;
- prompt-template management;
- usage/cost limits;
- model metadata;
- quarantine;
- retry and idempotency;
- generation review dashboard.

No real key in source control.

## Phase 5 — Optional integrations

Separate approval required for each:

- YouTube metadata import;
- YouTube Analytics;
- YouTube publishing;
- newsletter provider;
- object storage;
- public deployment;
- website analytics;
- sponsor CRM.

## Phase 6 — Scale

Only after proven use:

- background queue;
- multiple workspaces;
- localization;
- team notifications;
- richer asset management;
- API;
- automated update monitoring;
- mobile capture workflow.

## Avoid premature work

Do not start with:

- microservices;
- Kubernetes;
- event streaming;
- vector database;
- multi-agent autonomous publishing;
- complex recommendation systems;
- full video rendering;
- an enterprise permissions engine;
- automated web scraping.

Add these only after a measured need.
