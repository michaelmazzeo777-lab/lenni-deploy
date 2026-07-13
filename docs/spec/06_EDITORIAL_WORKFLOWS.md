# Editorial Workflows

## Workflow states

```text
IDEA
→ TRIAGE
→ RESEARCH
→ EVIDENCE_READY
→ OUTLINE
→ SCRIPT_DRAFT
→ SCRIPT_REVIEW
→ PRODUCTION
→ EDIT_REVIEW
→ PACKAGING
→ RIGHTS_REVIEW
→ APPROVAL
→ READY
→ PUBLISHED
→ UPDATE_DUE
→ ARCHIVED
```

## Transition requirements

### IDEA → TRIAGE
- working title;
- content type;
- pillar;
- viewer promise.

### TRIAGE → RESEARCH
- owner;
- priority;
- audience intent;
- source plan.

### RESEARCH → EVIDENCE_READY
- at least one reviewed source;
- at least one reviewed claim;
- no unresolved required source conflict hidden from view.

### EVIDENCE_READY → OUTLINE
- approved evidence boundary;
- prohibited assertions recorded.

### OUTLINE → SCRIPT_DRAFT
- current outline;
- target duration;
- selected claims.

### SCRIPT_DRAFT → SCRIPT_REVIEW
- current script version;
- uncited-fact scan completed;
- spoiler classification.

### SCRIPT_REVIEW → PRODUCTION
- editor approval;
- visual plan;
- capture requirements.

### PRODUCTION → EDIT_REVIEW
- asset list;
- draft edit reference;
- music status;
- visual/source mapping.

### EDIT_REVIEW → PACKAGING
- edit-review decision;
- correction blockers resolved.

### PACKAGING → RIGHTS_REVIEW
- at least one title;
- at least one thumbnail brief;
- deception and independence checks.

### RIGHTS_REVIEW → APPROVAL
- every used asset reviewed;
- no blocking asset;
- sponsor/affiliate disclosures recorded when relevant.

### APPROVAL → READY
- final editorial approval;
- rights approval;
- packaging approval;
- public-site approval decision;
- no stale required claim;
- no blocking correction.

### READY → PUBLISHED
MVP:
- human records external URL and publication time;
- or publishes the approved public article to the local/staging site.

No external API call.

## Change invalidation

Material changes invalidate approval when they affect:

- title claim;
- factual claim;
- script thesis;
- spoiler level;
- asset set;
- thumbnail content;
- sponsor language;
- public article body.

Minor typography and formatting changes may preserve approval when the audit event records the reason.

## 14-day pilot seed workflow

Seed three parent content items:

1. Everything Rockstar Has Officially Confirmed About GTA VI in 15 Minutes
2. GTA VI Standard vs Ultimate: What the Extra Money Actually Buys
3. Can We Rebuild Leonida Using Official Evidence Only?

Seed three related Shorts for each.

## Experiment workflow

1. State question.
2. Define variables and controls.
3. Record game version/platform/date/settings.
4. Define sample size.
5. Capture observations.
6. Mark result as supported, contradicted, or inconclusive.
7. Separate measured result from interpretation.
8. Record retest trigger.

## Correction workflow

1. Report issue.
2. Triage severity.
3. Freeze affected approval when material.
4. verify source.
5. draft correction.
6. approve correction.
7. update public revision.
8. record public notice.
9. create update task for related content.
