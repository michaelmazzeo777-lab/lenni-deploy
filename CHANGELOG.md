# Changelog — Field Guide Studio (local recovery branch)

Branch `recovery/fable-052`, based on `713431b` (July 19, 2026 head of
`claude/field-guide-studio-pot79b`). Local only: nothing pushed, merged or deployed.
Full completion record: `docs/LOCAL_STUDIO_COMPLETION.md`.

## 2026-11-15

### `062d4f4` Recovery baseline

- `scripts/dev-db.sh`: project-local PostgreSQL 16 cluster in `.data/pg` (no login service).
- Fixed a timing race in `tests/e2e/shorts.spec.ts` (navigated away before the review action finished).

### `508f0ff` Real local Shorts pipeline

- **Capture intake** (`domain/captureMedia.ts`, `/studio/captures`): attach a real video from the
  ingest folder with operator, method, device, rights, ffprobe data and SHA-256. Refuses path
  traversal, symlinks, non-video files and duplicates.
- **Highlight ranking** (`lib/media/highlights.ts`): explainable motion / audio level / audio onset /
  scene-cut score with black- and still-frame exclusion, thumbnails, approve / reject / trim.
- **Local providers** (`lib/shorts/local-providers.ts`): operator-written script, macOS-voice
  fixture narration, operator recording, FFmpeg compositor (9:16 and 16:9, burned captions).
  Mocks remain the default and are still used by the original tests.
- **Review bundle** per render: `master.mp4`, `captions.srt`, `transcript.txt`, `cover.jpg`,
  `manifest.json` (provenance, source timecodes, hashes), `bundle.zip`.
- **Gates:** uncleared rights, licensed music, leak references, empty or silent narration,
  rejected cuts; any fixture input makes a render permanently unpublishable.
- Authenticated, workspace-scoped, range-capable media route `/studio/media/[kind]/[id]`.
- Migration `20261115174112_capture_media_highlights` (additive).

### `4436a30` Canonical taxonomy, stale gate, pilot queue

- `domain/canonicalTaxonomy.ts`: read-only mapping from the repo's claim classes to the canonical
  v1.3 classes. Repo `OBSERVED` never becomes `OBSERVED_IN_GAME`; `LEAKED` stays quarantined;
  stale or retired claims map to `STALE_OR_CONTRADICTED`. Shown on the Claims page and export.
- Real Shorts cannot be scripted or rendered while a linked claim is stale, contradicted or quarantined.
- `pnpm pilot:queue`: additive, idempotent 4-long / 8-Short pilot queue; generates
  `21_Pilot_Content_Queue_v1_0.md`. PROPOSED, pending Mike's review.
- Shorts page no longer offers a script form for a cut that already has a script.

### `0a0b08d` Code-review fixes

- A narration that does not fit the clip (or the 60 s Shorts ceiling) is refused instead of cut off.
- Re-running analysis no longer lists footage that already has a reviewed cut.
- A failed ingest removes its copied file and returns a clean error.

### `2a850dd` Regression and isolation tests

- `domain/mediaAccess.ts`: media-route authorization moved into a tested function.
- A double submit of the same file no longer deletes the stored copy (found while writing the tests).
- Tests for the three review fixes and for cross-workspace access to captures, cuts, renders,
  stored media and exports.

### Documentation

- This changelog and `docs/LOCAL_STUDIO_COMPLETION.md`.

### Dependency decision — `ffmpeg-full` (docs only)

- 2026-11-15: Mike **approved retaining** the existing Homebrew `ffmpeg-full` 9.0.2 as the local
  rendering dependency. Licence: GPL-3.0-or-later. Recorded with it: the package was originally
  installed without separate approval (only `postgresql@16` and `ffmpeg` had been approved).
- Not to be removed, reinstalled, upgraded or replaced. A separate licensing and dependency
  review is required before any distribution, packaging or deployment.
- No code changed. The verified `LOCAL_STUDIO_COMPLETE` baseline remains commit `2f43873`
  (tag `local-studio-complete-2026-11-15`).

## 2026-11-16 — Completion build (branch `build/completion-20261115`)

Not promoted: the Studio of record stays at `dd82a4a`. Full record: `docs/COMPLETION_BUILD.md`.

- **Explainer workflow.** A production session with no footage (`CaptureSession.kind = GRAPHICS`),
  an operator script whose lines carry their title cards, and a card generator
  (`lib/media/cards.ts`) with a native layout for 16:9 and for 9:16. No capture review, media
  ingest or highlight cut is involved; at least one linked, current claim is required.
- **Narration QA** (`lib/media/qa.ts`, `audio-qa.ts`, `align.ts`, `transcribe.ts`): clipping,
  leading silence, dead air inside a line, cut-off ending, local transcription against the
  script (whisper.cpp), captions against real speech onsets. A failing narration is not recorded.
- **Voice properties** recorded with each narration (synthetic or not, voice name, licence note).
  Recorded narration gets its caption times from the transcript instead of text length.
- **Render**: two-pass loudness normalization to -16 LUFS; long lines split into captions that
  fit the frame; 9:16 captions inside the player-safe area; a native vertical source now fills
  the frame instead of being raised 140 px.
- **Render QA** on the finished file: loudness and true peak, narration under every line,
  transcription against the script, caption timing, black frames, every card and caption
  visibly in the picture, plus a contact sheet. A failing master is deleted and not recorded.
- **Jobs** (`domain/mediaJobs.ts`, table `MediaJob`): one row per distinct request, duplicate
  prevention, one automatic retry of a failed media process, recorded failures, retry from the
  screen, takeover of an abandoned run.
- **Review states**: `ShortsRender.reviewState` (`PENDING_MIKE_REVIEW`, `MIKE_APPROVED`,
  `REJECTED`; `RENDERED` and `QA_CHECKED` are timestamped in `qaJson.stateHistory`), media class
  (`ENGINEERING_FIXTURE`, `ILLUSTRATIVE_DRAFT`, `GAMEPLAY_CAPTURE`) and truthful burned-in labels.
  `approveRenderVersion` is Owner-only and bound to the file's SHA-256. Publish gates only got
  stricter: illustrative drafts and unapproved files are refused in addition to fixtures.
- **Migration** `20261116043000_media_jobs_qa_review`: additive only (five enums, nullable or
  defaulted columns, one table).

### Found by the acceptance run and the first real production, and fixed

- **Loudness landing low on short clips.** loudnorm falls back to dynamic gain when a linear gain would break the peak ceiling; a short fixture render came out at -17.1 LUFS and the QA gate refused it.
- **AAC encoder lifting true peaks.** On the real Demo 001 narration the encoder raised true peak from -1.5 dBFS (what loudnorm set) to +0.3 dBFS; the QA gate refused that render too.
- The compositor now measures the encoded master and, while it misses the loudness target or the peak ceiling, encodes the audio again with the missing gain behind a peak limiter (three tries at most; the picture is copied untouched). QA still makes the final judgement.
- `tests/production/demo-001.spec.ts` + `playwright.production.config.ts`: a repeatable, re-runnable script that produces Demonstration Video 001 (rebuilt) through the Studio screens as the Editor and Producer demo accounts. It never signs in as the Owner and never approves, rejects or publishes.

## Not changed

- No public-site, auth, RBAC, approval or audit behavior was altered.
- `YOUTUBE_PUBLISHER` is still `mock`; a non-mock value still throws. No external account, API key,
  console control or scheduled job was added.
