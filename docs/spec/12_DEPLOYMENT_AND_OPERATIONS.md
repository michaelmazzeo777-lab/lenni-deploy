# Deployment and Operations

## Current status

Production provider, domain, account, region, billing, authentication provider, database provider, storage provider, and monitoring provider are OPEN.

Do not deploy without Mike's exact approval.

## Local development

Required:

- supported Node.js runtime;
- package manager selected by the implementation;
- local PostgreSQL or documented compatible substitute;
- `.env.local` created by the operator and not committed.

Provide:

- one-command or clearly sequenced setup;
- database migration;
- seed;
- dev server;
- tests;
- production build;
- reset procedure.

## Environment variables

Names may include:

```text
DATABASE_URL
AUTH_SECRET
APP_BASE_URL
ANTHROPIC_API_KEY
AI_PROVIDER
AI_MOCK_MODE
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ACCESS_KEY
OBJECT_STORAGE_SECRET_KEY
```

No real values in source control.

## Environment separation

- local;
- test;
- staging;
- production.

Draft/staging pages must not be indexed.

## Migration policy

- generate migration;
- inspect SQL;
- test against representative local data;
- back up before production;
- approve exact change;
- deploy;
- verify;
- retain rollback or forward-fix plan.

## Backup

Before production:

- database backup policy;
- asset backup policy;
- restoration test;
- retention decision;
- owner;
- recovery objectives.

## Deployment gate

Before any production deployment:

1. exact target;
2. account and owner;
3. files/data involved;
4. secrets path;
5. expected cost;
6. tests;
7. blast radius;
8. rollback;
9. monitoring;
10. Mike's approval.

## Publication integration gate

Before YouTube or CMS connection:

- official API documentation rechecked;
- account and channel verified;
- OAuth scopes minimized;
- sandbox/test channel when available;
- publish action requires human confirmation;
- draft/private default;
- idempotency;
- error recovery;
- revocation;
- audit logging;
- approval.

## Incident response

- stop affected integration;
- preserve logs;
- rotate exposed credentials;
- revoke sessions/tokens;
- assess public content;
- restore last verified state;
- record incident and prevention.
