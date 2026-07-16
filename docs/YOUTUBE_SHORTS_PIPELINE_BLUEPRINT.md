# YouTube Shorts Pipeline — Full Build Blueprint

**Status:** Draft — Full specification, not yet implemented. `BLOCKED` on Mike supplying real
credentials (see "What Mike needs to provide" below); no external account created, no code
written, no secret stored. This blueprint supersedes the earlier comparison document's module
descriptions where they differ, based on Mike's clarification: **all source footage is
Mike/team-provided — there is no anonymous public-submission intake.** That single fact changes
the rights-risk profile substantially: this is now an extension of the existing
Contributor/CaptureSession system, not a new legal exposure.

## 1. Scope statement

Build an assisted (not fully autonomous) pipeline that takes gameplay footage Mike or a
Contributor uploads, produces a YouTube Short (AI-drafted script, synthesized voiceover,
vertical-crop composite), and — after human approval — publishes it to a real YouTube channel.
"Full build" here means: complete data model, complete provider interfaces (mock-first, exactly
like the existing `AIProvider`/`VisualProvider` pattern), and a complete integration guide.
It does **not** mean OAuth credentials or any live external connection exist yet — those require
Mike to supply real values, at which point the mock providers are swapped for real ones the same
way `AI_PROVIDER=anthropic` already works today.

## 2. Rights model — reuses `CaptureSession`, does not replace it

No new "community submission" table. Shorts source footage is submitted the same way gameplay
capture already is:

- Mike or a Contributor uploads via the existing capture-submission flow (`domain/capture.ts`),
  producing a `CaptureSession` row (`fileReference`, `flagLeaked`, `spoilerLevel`,
  `containsLicensedMusic`, `modsDeclared`, `status`).
- `flagLeaked: true` already forces `status: BLOCKED` and refuses `APPROVED` on review
  (`domain/capture.ts:71,106`) — no separate leaked-check needs building.
- **New, minimal addition:** a `targetsShorts: Boolean @default(false)` field (or a
  `SHORTS`-specific `Assignment` type, whichever fits better once implemented) so the pipeline
  knows which reviewed, approved captures are candidates for Short generation. Everything else
  about rights review is unchanged.

This means Module 1 from the original spec is **not built as originally written** (open public
intake, boolean waiver) — it is replaced entirely by "use the existing, already-audited capture
review flow." `REALITY` today: the capture submit/review flow already exists and is tested.
`PROPOSED`: the `targetsShorts` flag.

## 3. Data model additions (Prisma-style, not yet migrated)

```prisma
// A Short is generated FROM an approved CaptureSession, never from unreviewed footage.
model ShortsScript {
  id              String   @id @default(cuid())
  workspaceId     String
  captureSessionId String
  provider        String              // "mock" | actual provider name, never assumed
  model           String              // actual configured model identifier
  hookText        String
  sections        Json                // { text, timestampSec }[]
  detectedHighlights Json             // from CV analysis, for editor reference
  safetyFlags     Json                // any positive flags route to human review, never auto-filtered
  status          AIValidationStatus  // reuse existing enum: VALID | QUARANTINED | FAILED
  createdBy       String
  createdAt       DateTime @default(now())

  captureSession CaptureSession @relation(fields: [captureSessionId], references: [id])
}

model ShortsVoiceover {
  id             String   @id @default(cuid())
  scriptId       String   @unique
  provider       String
  voiceProfileId String
  assetPath      String              // via existing AssetStorage/LocalAssetStorage, quarantine-scanned like any upload
  duckingCurve   Json                // { timestampSec, gainDb }[]
  createdAt      DateTime @default(now())

  script ShortsScript @relation(fields: [scriptId], references: [id])
}

model ShortsRender {
  id             String   @id @default(cuid())
  scriptId       String
  voiceoverId    String
  storagePath    String              // quarantine-first, same as existing StoredFile pattern
  durationSec    Float
  resolution     String              // e.g. "1080x1920"
  frameRate      Int                 // recommend 30, see feasibility note below
  renderCostUsd  Float
  status         QuarantineStatus    // reuse existing enum: PENDING | CLEAN | REJECTED
  createdAt      DateTime @default(now())

  script     ShortsScript     @relation(fields: [scriptId], references: [id])
  voiceover  ShortsVoiceover  @relation(fields: [voiceoverId], references: [id])
}

// Publish gate reuses the existing Approval/ApprovalScope pattern with one new scope value
// (add "YOUTUBE_SHORTS" to the ApprovalScope enum) rather than a bespoke webhook-only gate.
// SCOPE_GRANTERS["YOUTUBE_SHORTS"] should be [Role.OWNER] only, mirroring PUBLIC_WEBSITE today.

model YouTubePublication {
  id            String   @id @default(cuid())
  renderId      String   @unique
  youtubeVideoId String?             // populated only after a real, successful publish call
  title         String
  description   String
  tags          String[]
  disclosureFlags Json              // C2PA / altered-or-synthetic markers sent in the payload
  status        PublicationStatus   // reuse existing enum: DRAFT | PUBLISHED | UNPUBLISHED
  publishedBy   String?
  publishedAt   DateTime?
  createdAt     DateTime @default(now())

  render ShortsRender @relation(fields: [renderId], references: [id])
}
```

All of the above reuses existing enums (`AIValidationStatus`, `QuarantineStatus`,
`PublicationStatus`) and existing patterns (quarantine-first storage, scoped approvals,
audit-on-every-mutation) rather than inventing parallel concepts — consistent with how every
other slice in this codebase has been built.

## 4. Provider interfaces (mock-first, exactly like `AIProvider`/`VisualProvider`)

```ts
// lib/shorts/types.ts (not yet created)
interface ShortsScriptProvider {
  readonly name: string;
  analyzeAndDraft(input: { videoUrl: string; durationCeilingSec: number }): Promise<{
    detectedHighlights: { timestampSec: number; label: string; confidence: number }[];
    safetyFlags: { timestampSec: number; category: string; confidence: number }[];
    script: { hookText: string; sections: { text: string; timestampSec: number }[] };
    model: string; // actual configured identifier
  }>;
}

interface TTSProvider {
  readonly name: string;
  synthesize(input: { scriptText: string; voiceProfileId: string }): Promise<{
    audioAssetPath: string;
    durationSec: number;
  }>;
}

interface VideoCompositorProvider {
  readonly name: string;
  render(input: {
    sourceVideoPath: string;
    voiceoverAssetPath: string;
    musicTrackPath?: string;
    attributionText: string;
    cropWindow: { x: number; y: number; width: number; height: number };
  }): Promise<{ renderedVideoPath: string; durationSec: number; renderCostUsd: number }>;
}

interface YouTubePublisher {
  readonly name: string;
  publish(input: {
    videoPath: string;
    title: string;
    description: string;
    tags: string[];
    disclosureFlags: Record<string, boolean>;
  }): Promise<{ youtubeVideoId: string }>;
}
```

Each ships with a deterministic `Mock*` implementation as the default (no cost, no external
call, fully testable) — identical to how `MockAIProvider` and `MockVisualProvider` work today.
Real implementations are selected only via explicit env-var configuration and are `disabled`
(throw a clear error) until the required credentials are present, exactly like
`AnthropicAIProvider` does today when `ANTHROPIC_API_KEY` is unset.

## 5. Environment variables Mike will need to supply (names only — never real values here)

To add to `.env.example` when this is built, all currently blank/unset:

```
# Text-to-speech provider (choose one; leave blank to use the mock voice).
TTS_PROVIDER=""                 # e.g. "elevenlabs" | "google" | "azure" | "mock" (default)
TTS_API_KEY=""

# Video compositor/render provider (choose one; leave blank to use the mock renderer).
VIDEO_COMPOSITOR_PROVIDER=""    # e.g. "shotstack" | "remotion-lambda" | "mock" (default)
VIDEO_COMPOSITOR_API_KEY=""

# YouTube Data API v3 — required only when real publishing is approved and configured.
YOUTUBE_CLIENT_ID=""
YOUTUBE_CLIENT_SECRET=""
YOUTUBE_REFRESH_TOKEN=""         # obtained via a one-time OAuth consent flow Mike runs himself
YOUTUBE_CHANNEL_ID=""
```

## 6. What Mike needs to provide, and in what order

This is the sequencing Mike's message asked for — blueprint first, real info second:

1. **A Google Cloud project** with the YouTube Data API v3 enabled, and an OAuth consent screen
   configured for the channel. This is a Google Cloud Console action only Mike can do — it
   cannot be automated by me and involves accepting Google's own terms for the channel.
2. **OAuth client credentials** (`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`) generated from
   that project, and a refresh token obtained by running the consent flow once, authorizing the
   actual channel.
3. **A TTS provider account** (pick one: ElevenLabs, Google Cloud TTS, Azure — see cost notes
   below) and its API key.
4. **A video-render provider account** (Shotstack is the simplest managed option; Remotion
   Lambda is cheaper at volume but requires Mike or me to set up AWS infrastructure separately)
   and its API key.

None of these are things I can generate on your behalf — they all require you to create the
account/project and accept that provider's own terms. Once you provide them (as environment
variable values, never pasted into chat), the corresponding mock provider is swapped for the
real one, the same way the Anthropic provider already works.

## 7. Recommended rollout gating (a recommendation, not a unilateral decision)

Even once real credentials exist, I'd recommend the human approval step (reusing the
`YOUTUBE_SHORTS` approval scope, Owner-only) remain a real, required gate before each publish —
not a formality — at least until you've watched a reasonable number of renders and are
comfortable with the script/voice/render quality. This mirrors how every other publish path in
this app already works (disabled button until ready, independently re-checked server-side). If
you want a period of full automation later, that's a separate decision to make once you've seen
the pipeline's actual output quality.

## 8. Budget/SLA feasibility — carried forward from the architecture-comparison doc, unchanged

- Managed cloud rendering (Shotstack) runs $0.20–0.30/minute — a 45–60s Short can consume the
  entire stated $0.25/video budget on rendering alone, before TTS or script generation.
  [Shotstack pricing](https://shotstack.io/vs/remotion-alternatives/)
- TTS cost is small by comparison: ~$0.003–0.07/video depending on voice quality tier.
  [TTS pricing comparison](https://awesomeagents.ai/pricing/voice-tts-pricing/) ·
  [ElevenLabs pricing](https://elevenlabs.io/pricing/api)
- Recommend 30fps over 60fps — roughly halves render cost/bandwidth, and community/self-captured
  gameplay footage is not reliably 60fps to begin with.
- 3-minute end-to-end latency is a plausible engineering target but unverified without an actual
  load test (`HUMAN_VALIDATION_REQUIRED`).

## 9. What happens next

This document is the complete blueprint. `REALITY` today: nothing beyond this document exists —
no migration has run, no provider interface file has been created, no env var has been added.
The next steps, once you're ready, are ordinary implementation slices (schema migration →
provider interfaces with mocks → UI → tests), the same process every other feature in this app
went through — I'd build and verify each with the same rigor (tests, full verify chain) rather
than all at once. Real external credentials only get wired in when you actually provide them.
