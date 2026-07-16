# Autonomous Daily-Shorts Pipeline — Architecture Comparison

**Status:** Draft — Architecture and schema design only. **No code implemented, no external
service connected.** Modules 1 and 6 below are `BLOCKED` per `CLAUDE.md`'s External Actions
rule ("do not create external accounts, publish to YouTube, or connect Google/YouTube APIs
unless Mike gives exact approval for that action") and remain blocked until Mike gives written,
specific approval for those two actions — a general request to compare architectures is not
that approval.

## Purpose and scope

This document answers the "AI System Directive: Autonomous YouTube Content Pipeline for GTA 6"
specification at the architecture/schema/API-contract level, so it can be compared against the
actual Field Guide Studio build. It deliberately does **not** include:

- production source code (Deliverable 2 of the original spec),
- execution environment setup / Dockerfiles (Deliverable 3),
- a deployment/integration runbook for a live system (Deliverable 4, partially addressed below
  as "what would be required if approved"),
- any YouTube OAuth client, credential, or API call,
- any open public-submission intake endpoint.

Everything below is `PROPOSED` (designed, not built) unless explicitly marked otherwise.

## Honest comparison to the existing Field Guide Studio build

| Concern                   | This spec, as written                                               | Field Guide Studio (actually built)                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footage rights intake     | Boolean waiver flag from any public submitter                       | Human Rights Reviewer role, license-basis field, prohibited-use flags, DB-level hard block on LEAKED/early-copy/minimally-edited source footage                                                                 |
| AI content grounding      | CV auto-analysis of unreviewed raw footage drives script generation | AI drafts only from claims a human already logged and classified (CONFIRMED/OBSERVED/ANALYSIS/etc.); invented claim IDs are rejected by a validation pipeline                                                   |
| Human gate before publish | One approve/reject step, then automated bot publish                 | Five independently-scoped approvals (facts, script, rights, packaging, public-website), each restricted to specific roles, re-validated against a content hash so a post-approval edit invalidates the sign-off |
| Who can publish           | The system itself, via OAuth, once approved                         | Only a human Owner, and only when every required approval is present — enforced twice (disabled button in the UI, independent server-side check)                                                                |
| Public destination        | Directly to YouTube (external platform)                             | To the operator's own website; YouTube publish is explicitly out of scope without separate approval                                                                                                             |

The honest read: this spec is a **higher-throughput, lower-rights-scrutiny** system. That's a
legitimate design point for some products, but it is a materially different risk posture than
the one your own project rules established, not a strict upgrade.

## End-to-end data flow

```
Community      IP-rights        CV analysis /      TTS + audio       Cloud video        Human
submission  →   gate         →   AI scripting   →   ducking       →   compositor    →   approval
(BLOCKED)       (BLOCKED)        (PROPOSED)         (PROPOSED)        (PROPOSED)         gate
                                                                                          (PROPOSED)
                                                                                              │
                                                                                              ▼
                                                                                     YouTube OAuth
                                                                                       publisher
                                                                                       (BLOCKED)
```

## Module-by-module design

### Module 1 — Community Ingestion & IP Rights Gateway — `BLOCKED`

Blocked because it (a) creates an open public-submission surface with only a boolean rights
check, weaker than the existing human-reviewed rights model, and (b) is the intake half of a
pipeline whose output half (Module 6) is itself blocked. If this were ever approved, the
recommended design is **not** the spec's boolean-flag intake but an extension of the existing
`RightsReview`/`Asset` domain model: a submission creates a `PENDING`-state asset that a human
Rights Reviewer must classify (license basis, ownership, prohibited-use flags) before it can
enter Module 2 at all — i.e., reuse the rigor already built, not a new lighter-weight gate.

Conceptual schema (if ever approved):

```
CommunitySubmission
  id, submitterId, submittedAt, clipCategory,
  rightsWaiverAccepted: boolean,      -- necessary but NOT sufficient (see above)
  storagePath, checksumSha256,
  rightsReviewStatus: PENDING | APPROVED | REJECTED   -- human gate, mirrors existing RightsReview
```

### Module 2 — Multimodal Analysis & Script Generation — `PROPOSED`

Technically buildable as a new `AIProvider`-style task type (`SHORT_SCRIPT`), following the
existing mock-first pattern: a deterministic mock for development, a real CV/LLM provider gated
behind explicit enablement. Input/output contract:

```
Input:  { videoUrl: string, durationCeilingSec: number }
Output: {
  detectedHighlights: { timestampSec: number, label: string, confidence: number }[],
  safetyFlags: { timestampSec: number, category: string, confidence: number }[],
  script: { hookText: string, sections: { text: string, timestampSec: number }[] },
}
```

Safety-trigger detection (sustained graphic non-combatant violence) should route to a human
reviewer on any positive flag, not auto-filter silently — consistent with "the application may
assist with risk review... but must not [decide] without human legal/editorial review."

### Module 3 — Dynamic Audio Synthesis & Ducking — `PROPOSED`

```
Input:  { scriptText: string, voiceProfileId: string, musicTrackId: string }
Output: { voiceoverAssetPath: string, duckingCurve: { timestampSec: number, gainDb: number }[] }
```

Straightforward provider-interface addition (`TTSProvider`), same seam pattern as the existing
`VisualProvider` abstraction (mock default, real provider disabled until approved).

### Module 4 — Cloud Compositor & Render Engine — `PROPOSED`

```
Input:  { sourceVideoPath, voiceoverAssetPath, musicTrackPath, attributionText, cropWindow, script }
Output: { renderedVideoPath, durationSec, resolution, frameRate, renderCostUsd }
```

See the feasibility analysis below — the 1080×1920@60fps target should be revisited.

### Module 5 — Human-in-the-Loop Approval — `PROPOSED`, maps onto existing concepts

This is the one module that's philosophically consistent with the existing build. It should
reuse the existing `Approval`/audit pattern rather than a new webhook-only design: render a
preview, require an explicit role-scoped decision (Approve / Regenerate / Reject-and-purge),
and audit every decision — exactly like the current publish gate, just for this pipeline's
output instead of an article.

### Module 6 — YouTube Data API v3 Auto-Publisher — `BLOCKED` / `APPROVAL_REQUIRED`

This is real external-account creation, real OAuth credentials, and real automated publishing
to a third-party platform — the exact action `CLAUDE.md` reserves for Mike's explicit, specific
approval, separate from any other decision in this conversation. Even with that approval, the
"one human click, then a bot publishes" design is a lighter human gate than everything else in
this codebase; I'd recommend the human review at Module 5 include the exact title/description/
tags that will be submitted, not just the video, since those are also public claims.

## SLA & budget feasibility — checked against real published pricing, not assumed

**Rendering cost.** Shotstack (a managed cloud video-render API) publishes $0.30/minute
pay-as-you-go, or $0.20/minute on its subscription tier.
[Shotstack pricing](https://shotstack.io/vs/remotion-alternatives/) A 45–60 second Short is
0.75–1.0 minutes of render time, so **rendering alone costs roughly $0.15–$0.30 per video** —
that's already at or over the entire stated $0.25/video budget, before TTS, script-generation,
CV analysis, storage, or bandwidth are added. Remotion Lambda avoids the per-minute fee but
requires self-hosting AWS infrastructure and separate AWS compute billing, so its true unit cost
depends on engineering investment and volume, not a simple published rate.
[Remotion Lambda cost](https://www.remotion.dev/docs/lambda/cost-example)

**TTS cost.** A 45-second script is roughly 110 spoken words (~600–650 characters at typical
speaking pace). At the cheapest usable tiers — Google Standard/WaveNet or Amazon Polly Standard,
around $4 per million characters — that's about **$0.003 per video**, negligible.
Higher-quality voices (ElevenLabs Flash/Turbo at ~$50/million characters, or Multilingual v2 at
$0.10/1,000 characters) run **$0.03–$0.07 per video** instead — still small next to the
rendering cost.
[TTS pricing comparison](https://awesomeagents.ai/pricing/voice-tts-pricing/) ·
[ElevenLabs pricing](https://elevenlabs.io/pricing/api)

**Conclusion:** the stated **$0.25/video target is tight-to-infeasible** using off-the-shelf
managed rendering (Shotstack) — rendering alone can consume the entire budget. It becomes
plausible only with self-hosted rendering infrastructure, real engineering investment, and
likely dropping from 60fps to 30fps (see below). This is a genuine target-vs-reality gap in the
original spec, not a detail to wave past.

**Frame rate.** 1080×1920@60fps roughly doubles encode time, storage, and bandwidth versus
30fps for the same duration, directly worsening the render-cost problem above. Community-
submitted gameplay footage is also unlikely to be reliably captured at 60fps to begin with.
Recommend re-specifying to 30fps unless there's a concrete reason 60fps is required — most
commentary-over-gameplay Shorts content on the platform does not need it.

**3-minute end-to-end latency.** Plausible for a well-optimized async pipeline (CV+script
generation in tens of seconds, TTS in seconds, compositing the dominant cost) but this is
`HUMAN_VALIDATION_REQUIRED` — no load test has been run, so treat it as an engineering target,
not a verified number.

## Policy/compliance notes

- **C2PA / synthetic-disclosure metadata fields** — a legitimate, buildable requirement; maps
  cleanly to additional fields on the publish payload. No design conflict.
- **Content-safety filtering for graphic violence** — legitimate; should route to human review
  on any positive flag rather than auto-filtering silently, consistent with this project's
  existing "human review, not silent AI judgment" pattern.
- **"Substantive transformation... to pass YouTube's reuse/monetization checks"** — worth
  re-framing. Genuinely adding editorial/analytical value (what Field Guide Studio already does)
  is what actually satisfies the platform's reused-content policy. Designing specifically to
  defeat an automated reuse classifier is a different goal and not one this document designs
  toward.
- **Legal rights waivers** — recommend the deeper human-reviewed model already built (Rights
  Reviewer role, license-basis tracking, hard DB blocks) over a boolean submission flag; see
  Module 1.

## What full implementation would require, if ever approved

Net-new components, all `PROPOSED` pending Mike's decision to build any of this:
`CommunitySubmission` intake + review model (extending existing `RightsReview`), a `TTSProvider`
interface (mirroring the existing `VisualProvider` seam), a video-compositor provider interface,
a Shorts-specific approval flow (extending the existing `Approval` audit pattern), and — only
with separate, explicit written approval — YouTube OAuth credentials and a publish integration.
None of this has been built; this document is the design-level comparison artifact requested,
nothing more.

## Sources

- [Shotstack pricing](https://shotstack.io/vs/remotion-alternatives/)
- [Remotion Lambda cost example](https://www.remotion.dev/docs/lambda/cost-example)
- [TTS API pricing comparison, 2026](https://awesomeagents.ai/pricing/voice-tts-pricing/)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
