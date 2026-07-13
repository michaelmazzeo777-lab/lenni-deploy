# Acceptance Tests

## A. Repository and quality

1. Fresh clone follows README and starts locally.
2. `.env.example` contains names and safe placeholders only.
3. Strict type checking passes.
4. Lint and formatting checks pass.
5. Production build passes.
6. No secrets are committed.
7. Database migrations apply to an empty database.
8. Seed is repeatable or clearly resets test data.

## B. Authentication and authorization

9. Anonymous users cannot enter `/studio`.
10. Read Only cannot mutate records.
11. Researcher can create sources and proposed claims.
12. Researcher cannot approve publication.
13. Rights Reviewer can review assets but cannot grant final editorial approval.
14. Owner can grant scoped approval.
15. Direct API calls enforce the same permissions as UI actions.

## C. Evidence

16. `CONFIRMED` cannot be approved without an official source.
17. `OBSERVED` can cite official visual material without becoming confirmed.
18. `ANALYSIS` remains labeled in generated content.
19. `PREDICTION` requires assumptions.
20. `RUMOR` requires named source context.
21. `UNVERIFIED` cannot silently display as fact.
22. `LEAKED` is quarantined and cannot enter a publishable revision.
23. Conflicting claims remain visible.
24. Stale source creates an update warning.

## D. AI

25. Mock provider returns schema-valid deterministic output.
26. AI output cites only allowed source and claim IDs.
27. Invented IDs cause quarantine.
28. `LEAKED` input or output causes block/quarantine.
29. Unsupported statements appear in the unsupported list.
30. AI draft cannot publish directly.
31. Human accept/reject decision is audited.
32. Prompt-injection text inside a source is treated as data.
33. Missing API key does not break mock/demo mode.

## E. Workflow and approvals

34. `EVIDENCE_READY` fails without evidence.
35. `SCRIPT_REVIEW` fails without a script.
36. `RIGHTS_REVIEW` fails without assets ledger completion.
37. `READY` fails without all required approvals.
38. Material script edit invalidates prior approval.
39. Website approval does not grant YouTube approval.
40. Status override requires Owner and reason.
41. Every transition creates an audit event.

## F. Rights

42. Blocked asset prevents `READY`.
43. Unreviewed third-party asset prevents `READY`.
44. Fake-trailer flag prevents approval.
45. Isolated-cutscene flag prevents approval.
46. Unlicensed-music flag prevents approval.
47. Mass-produced-AI flag prevents approval.
48. Fan-channel independence check is required.

## G. Public site

49. Draft content is not publicly routable.
50. Approved public revision renders.
51. Article displays last verified date.
52. Article displays source references.
53. Article displays spoiler label.
54. Article displays classification labels where applicable.
55. Article displays independence disclaimer.
56. Correction appears on affected article.
57. Sitemap excludes drafts.
58. Page has a unique canonical URL.
59. Keyboard navigation and focus checks pass.
60. No official-looking Rockstar identity is used.

## H. Primary end-to-end path

61. Editor creates pilot content item.
62. Editor adds official source.
63. Researcher adds and reviews `CONFIRMED` claim.
64. Editor generates mock AI packet.
65. Writer saves a script version.
66. Producer adds placeholder asset.
67. Rights Reviewer approves asset.
68. Editor creates packaging variants.
69. Owner grants scoped approvals.
70. Owner publishes a local public article.
71. Public page renders.
72. Editor records correction.
73. New public revision displays correction.
74. Audit timeline contains all events.

## I. Failure handling

75. Invalid transition returns actionable error.
76. AI timeout records failed job without partial approval.
77. Database error does not create half-complete approval.
78. Duplicate publish request is idempotent.
79. Unauthorized record ID returns no sensitive information.
80. Failed migration has documented rollback path.

## Completion standard

A test definition is not evidence. Record actual command, result, environment, and unresolved failures in `docs/IMPLEMENTATION_STATUS.md`.
