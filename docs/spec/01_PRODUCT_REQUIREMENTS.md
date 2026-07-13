# Product Requirements

## Epic 1 — Identity, roles, and workspaces

### Requirements

- Authenticate users.
- Support Owner, Editor, Researcher, Writer, Producer, Rights Reviewer, Analyst, and Read Only roles.
- A user may have multiple roles.
- Server-side authorization is mandatory.
- Record actor identity on audit events.
- Support one editorial workspace in MVP, with a path to multiple brands later.

### Acceptance

- A Researcher can create sources and claims but cannot approve publication.
- A Rights Reviewer can approve or block assets.
- An Owner can grant roles and make final approval decisions.
- Read Only cannot mutate records.

## Epic 2 — Content portfolio

### Content types

- Long video
- Short
- Website guide
- News briefing
- Evidence analysis
- Experiment
- Documentary
- Community post
- Newsletter issue

### Fields

- title/work title;
- slug;
- content pillar;
- format;
- audience intent;
- search query;
- browse promise;
- status;
- priority;
- urgency;
- effort;
- spoiler level;
- embargo or not-before time;
- target length;
- owner;
- due date;
- related items;
- update trigger;
- public visibility.

### Views

- backlog;
- kanban;
- calendar;
- table;
- content detail;
- update queue.

## Epic 3 — Sources and evidence

### Source record

- title;
- owner/publisher;
- URL or internal locator;
- source type;
- official/reputable/community;
- publication date;
- retrieval date;
- factual as-of date;
- inspected section;
- archive/screenshot reference;
- status;
- stale date;
- notes.

### Claim record

- exact claim;
- classification;
- confidence;
- source links;
- support excerpt or paraphrase;
- editor notes;
- status;
- contradiction group;
- public wording;
- last reviewed.

### Required behaviors

- Claims may link to multiple sources.
- Source status changes should surface affected content.
- `CONFIRMED` claims require an official source.
- `LEAKED` claims are quarantined and cannot enter generated content.
- Conflicts remain visible; the system must not silently merge them.
- Stale claims create update tasks.

## Epic 4 — Briefs, outlines, and scripts

### Content brief

- objective;
- audience;
- viewer promise;
- angle;
- allowed evidence;
- prohibited assertions;
- structure;
- call to action;
- visual plan;
- rights notes;
- success metric;
- update trigger.

### Script

- versioned;
- chapter/section structure;
- inline claim references;
- word count;
- estimated duration;
- narrator notes;
- visual notes;
- review comments;
- approval status.

### Required behaviors

- Never overwrite a reviewed script without a new version.
- Support comparison between versions.
- Record author and generation metadata.
- Flag uncited factual paragraphs.
- Convert an approved script into a public article draft without changing fact classifications.

## Epic 5 — AI workbench

### Tasks

- create research plan;
- summarize selected source;
- extract proposed claims;
- create outline;
- draft long script;
- derive Shorts;
- produce website guide;
- create title variants;
- create thumbnail briefs;
- suggest corrections;
- analyze imported metrics.

### Required behaviors

- Selected evidence is the only factual grounding.
- Structured output validation.
- No direct publication.
- Store prompt template version.
- Store provider/model response metadata when available.
- Support deterministic mock mode.
- Quarantine unsupported or prohibited output.
- Human accept/reject/edit workflow.

## Epic 6 — Assets and rights

### Asset record

- filename or URL;
- original/third-party;
- owner;
- source;
- media type;
- intended use;
- license/policy basis;
- amount used;
- transformation;
- music;
- spoiler status;
- risk;
- reviewer;
- decision;
- timestamps or placement notes.

### Required behaviors

- Block `READY` when any used asset is unreviewed or blocked.
- Show independent-brand restrictions.
- Require notes for third-party media.
- No copyrighted media files in seed data.
- Permit metadata-only placeholder assets.

## Epic 7 — Packaging

- title variants;
- thumbnail briefs and image references;
- search-first vs browse-first;
- classification badge;
- mobile readability check;
- deception check;
- approval;
- performance observations after publication.

## Epic 8 — Approvals

### Gates

- evidence readiness;
- script approval;
- rights approval;
- packaging approval;
- final editorial approval;
- public-site publication approval;
- external-platform publication approval.

### Required behaviors

- Approvals are scoped and explicit.
- Approval for a website article does not approve YouTube publishing.
- Revoking approval returns the item to the correct state.
- A material edit after approval invalidates affected approvals.
- Every decision enters the audit log.

## Epic 9 — Public site

- publish only approved records;
- static or cached public pages;
- article version;
- last verified date;
- source list;
- classification and spoiler labels;
- disclaimer;
- corrections;
- related content;
- structured metadata and sitemap;
- fast and accessible rendering.

## Epic 10 — Corrections and updates

- correction type;
- severity;
- original text;
- corrected text;
- reason;
- source;
- affected content;
- public notice;
- created/resolved times;
- patch/version trigger;
- owner.

## Epic 11 — Analytics

### Manual-first inputs

- impressions;
- views;
- CTR;
- first-30-second retention;
- average percentage viewed;
- watch time;
- subscribers gained;
- traffic-source split;
- Shorts-to-long clicks;
- revenue fields when explicitly supplied;
- snapshot date.

### Outputs

- performance scorecard;
- topic/format comparison;
- packaging observations;
- update recommendation;
- continuation/pivot threshold status.

No API connection is required in MVP.

## Epic 12 — Audit and export

- append-only audit events;
- CSV/JSON export for user-owned records;
- source and claim packet export;
- content packet export;
- approval history export;
- no secrets in export.
