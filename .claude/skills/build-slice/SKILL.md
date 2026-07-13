---
name: build-slice
description: Build one complete Field Guide Studio vertical slice from acceptance criteria through implementation and verification.
argument-hint: "[slice or epic]"
disable-model-invocation: true
---

Build this vertical slice: $ARGUMENTS

1. Read `CLAUDE.md` and relevant specifications.
2. Inspect existing code and patterns.
3. State objective, scope, exclusions, and acceptance criteria.
4. Ask a question only when a material irreversible decision is impossible to infer.
5. Implement persistence, domain logic, authorization, UI, audit, and tests.
6. Run format, lint, type check, relevant tests, and build.
7. Use a browser test when the slice changes user behavior.
8. Report REALITY, evidence, risks, changed files, and next slice.

Do not deploy, publish, push, connect accounts, or use real credentials.
