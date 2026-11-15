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

## Not changed

- No public-site, auth, RBAC, approval or audit behavior was altered.
- `YOUTUBE_PUBLISHER` is still `mock`; a non-mock value still throws. No external account, API key,
  console control or scheduled job was added.
