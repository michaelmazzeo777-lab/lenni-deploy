---
name: verify-slice
description: Verify a Field Guide Studio implementation slice using actual commands, browser behavior, authorization tests, and acceptance criteria.
argument-hint: "[slice or feature]"
disable-model-invocation: true
---

Verify: $ARGUMENTS

1. Identify applicable tests in `docs/11_ACCEPTANCE_TESTS.md`.
2. Run format, lint, strict type check, tests, migration/seed when relevant, and production build.
3. Run the primary user path or a focused browser test.
4. Test direct unauthorized access.
5. Test failure paths and approval blocks.
6. Record actual commands and results.
7. Return PASS, PARTIAL, or FAIL.
8. Never infer success from code inspection alone when the behavior can be run.
