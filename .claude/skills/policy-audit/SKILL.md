---
name: policy-audit
description: Audit a Field Guide Studio feature or content workflow for rights, YouTube monetization, reused/inauthentic content, AI disclosure, advertiser suitability, and fan-channel independence.
argument-hint: "[feature, workflow, or file]"
disable-model-invocation: true
allowed-tools: Read Grep Glob
---

Audit: $ARGUMENTS

Return:

1. decision: PASS / PASS WITH PATCHES / BLOCK;
2. blocking findings;
3. high/medium/low risks;
4. evidence from the repository;
5. exact patch requirements;
6. tests to add;
7. human legal or policy validation still required.

Do not supply legal clearance. Do not treat a disclaimer as a license.
