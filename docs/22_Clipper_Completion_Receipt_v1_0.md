# 22 — Clipper completion receipt v1.0

| Field           | Value                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| PROJECT         | Welcome to Leonida — Field Guide Studio                                    |
| BUILD ID        | WTL-CLIPPER-COMPLETE-v1.1                                                  |
| DATE            | 2026-11-17                                                                 |
| SOURCE WORKTREE | `~/Welcome to Leonida/leonida-final-candidate`                             |
| BRANCH          | `candidate/clipper-complete-20261117`                                      |
| START COMMIT    | `f6f3c11` (feature/stream-clipper), tagged `pre-clipper-complete-20261117` |
| END COMMIT      | see `git log -1` on the branch (this receipt's commit follows `7c588c0`)   |
| FINAL STATE     | **CANDIDATE_READY_PENDING_HUMAN_QA**                                       |

Evidence logs: `~/Welcome to Leonida/clipper_complete_evidence_20261117/`.

## Where to start (Mike)

1. Open Terminal and run:
   ```bash
   cd ~/"Welcome to Leonida/leonida-final-candidate" && sh scripts/start-candidate.sh
   ```
   It picks Node 22, starts the candidate's own database (port 5433), rebuilds if
   the code changed, and serves **http://127.0.0.1:3400**. Sign in with the demo
   owner account shown on the sign-in page.
2. First thing to do: open **Library & review**, watch the clips, and score a few with
   `clipper_complete_evidence_20261117/EDITORIAL_REVIEW_RUBRIC.md`.
3. To clip real footage: put an authorized recording (H.264/HEVC, at most 2 h and
   20 GB) in `~/Welcome to Leonida/_inbox_footage/`, then **Capture intake** →
   approve the capture → _Attach video_ → **Clip a session**. Clips land in the
   Library as pending your review.
4. **Creators & rights** holds the 10 researched prospects (none contacted) and
   the agreement workflow. **Platform connections** shows what each platform
   allows and the manual publishing path.

Stop the database later with `sh scripts/start-candidate.sh stop`.

## Actual features implemented

**Clipper (Gate 2)**

- Audit fixes carried onto the clipper: test databases limited to
  `localhost:5433/fgcand_test` / `fgcand_e2e`; test servers on 127.0.0.1.
- One heavy media job at a time across narration, render, premium, session clip
  and stream jobs (Postgres advisory-locked slot); a heartbeat every 10 s fenced
  by attempt; recovery closes only a job whose heartbeat stopped; a runner that
  lost its job stops producing clips; every ffmpeg/whisper call is killed after
  15 minutes.
- The candidate has its own speech model (`.data/models/ggml-base.en.bin`,
  checksum identical to the baseline copy); `.env` points at it.
- Launcher: Node 22 after a restart, refuses an inherited DATABASE_URL, names
  missing tools, rebuilds when the code changed.

**Creators & rights (Gate 3)**

- Creator records (source, retrieval date, confidence, tier, published business
  contact only with its source), agreement drafts from a template, lifecycle
  DRAFT → LEGAL_REVIEW → APPROVED_TO_CONTACT → SENT → NEGOTIATING →
  EXECUTED_VERIFIED → ACTIVE → EXPIRED / REVOKED / REJECTED with written evidence
  per step, Owner-only steps, terms frozen once sent, full history.
- Recordings link to an agreement with third-party notes and a human rights
  review; expiry and revocation record every affected asset.
- Library: _internal draft export_ always available; _external delivery_ shows
  three independent layers (creator, platform, publisher/editorial) and cannot
  pass in this build.
- Draft licence template: `docs/templates/creator-footage-licence-draft-v1.md`
  (needs professional legal review).

**Platform connections (Gate 4)**

- YouTube, Twitch, Instagram, Facebook, TikTok × 10 functions, from official
  documentation read 2026-11-17, with unverified items marked. Manual publishing
  path, official links only, no connect buttons, no OAuth, no tokens, no upload
  code (a test scans the source for platform token/upload endpoints).

## Files changed

33 files, 3,717 insertions, 365 deletions since `f6f3c11` (plus this receipt).
New: `lib/jobs/heavy.ts`, `lib/testing/db-guard.ts`, `lib/rights/*`,
`lib/platforms/capabilities.ts`, `domain/creatorRights.ts`,
`app/studio/rights/*`, `app/studio/platforms/page.tsx`, migration
`20261117194942_creator_rights` and its rollback, research and import script,
template, 6 test files. Changed: `domain/{mediaJobs,premiumRender,sessionClip}.ts`,
`lib/media/ffmpeg.ts`, `app/studio/{layout,library/page}.tsx`, test configs,
launcher, `.env.example`.

## Test commands and results

| Check                     | Command                                                                       | Result                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration        | `TEST_DATABASE_URL=…localhost:5433/fgcand_test pnpm test`                     | **400 / 400** (45 files), `vitest-full.log`                                                                                 |
| Browser                   | `E2E_DATABASE_URL=…localhost:5433/fgcand_e2e pnpm test:e2e`                   | **13 / 13** clean run, `e2e-full-2.log` (an earlier run failed 1 on an ambiguous locator in the new test; fixed, `e2e.log`) |
| Build                     | `pnpm build`                                                                  | exit 0, `build.log`                                                                                                         |
| Secrets                   | `pnpm test:secrets`                                                           | clean (312 files)                                                                                                           |
| Format / lint / typecheck | `pnpm format:check`, `lint`, `typecheck`                                      | clean                                                                                                                       |
| Migration + rollback      | scratch DB `fgcand_rollback_check` on 5433: deploy → rollback SQL → re-deploy | all three succeeded; scratch DB removed                                                                                     |
| Launcher                  | `sh scripts/start-candidate.sh` with Node 20 first on PATH                    | picked Node 22, rebuilt, `/signin` 200, studio pages redirect when signed out (`launcher.log`)                              |
| Signed-in check           | browser on 127.0.0.1:3400                                                     | Creators & rights lists the 10 prospects                                                                                    |

## Media outputs

Nine representative clips (from the 10-minute **synthetic** test fixture, not
gameplay) in `clipper_complete_evidence_20261117/review_package/`, listed with
full SHA-256 in `MANIFEST.txt`. All decode as H.264 + AAC, 15.0–16.0 s, 1920×1080
or 1080×1920. Moment 1 rendered to the identical SHA-256 (`a213daf1…`) in two
separate runs.

## Acceptance matrix

| Test                              | Result                          | Evidence                                                            |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| A01 latest worktree/commit        | PASS                            | `f6f3c11` + `fix/audit-safety` reconciled onto one branch           |
| A02 baseline untouched            | PASS                            | `dd82a4a` clean; port 5432 not started or queried this run          |
| A03 clipper regression            | PASS                            | clipper integration + `clipper.spec.ts` inside 400/400 and 13/13    |
| A04 safe footage ingestion        | PASS (fixture)                  | labelled synthetic fixture; real authorized footage: none available |
| A05 16:9 and 9:16 rendering       | PASS                            | actual MP4s, ffprobe above                                          |
| A06 captions/audio/cuts QA        | PASS (technical)                | clip QA + no-mid-word test; caption accuracy on real speech UNRUN   |
| A07 cancel/retry/recovery         | PASS                            | browser cancel→retry; heartbeat, fence and recovery tests           |
| A08 concurrency/security          | PASS                            | heavy-slot, DB-guard, loopback, path tests                          |
| A09 Library review/export         | PASS                            | approve by hash, rejection, internal draft export bundle            |
| A10 editorial review              | PREPARED; review UNRUN          | rubric + review package; needs Mike                                 |
| A11 creator/agreement persistence | PASS                            | `creator-rights` integration (10) + browser test                    |
| A12 no false external clearance   | PASS                            | clearance unit tests; Library shows BLOCKED                         |
| A13 expiry/revocation             | PASS                            | affected assets recorded; review blocked after revoke               |
| A14 platform screens              | PASS                            | `platforms` unit tests + browser test                               |
| A15 manual instructions usable    | PASS (content); usability UNRUN | official sources linked                                             |
| A16 no external actions           | PASS                            | no connections; source scan test; nobody contacted                  |
| A17 Studio workflow intact        | PASS                            | all prior suites green                                              |
| A18 rollback                      | PASS                            | tag `pre-clipper-complete-20261117`; rollback SQL tested            |
| A19 operator startup              | PASS                            | launcher run above; steps in this receipt                           |
| A20 blockers assigned             | PASS                            | below                                                               |

## Creator-agreement state

10 prospects (PROSPECT, from vidIQ's list updated 2026-11-13); 1 channel URL
partly verified (MrBossFTW), 9 recorded as search links pending verification.
0 agreements in the operator database. Nobody contacted.

## Platform-connection state

0 connected. Every platform: NOT CONNECTED. Publication disabled.

## Security and data integrity

- Tests refuse any database except the two disposable ones on 5433.
- Migration additive only (no drops); applied to `fgcand_dev`, `fgcand_test`,
  `fgcand_e2e` only.
- No credentials read or stored; `.env` edited on one line (speech model path).
- Untracked `.agents/`, `.codex/`, `AGENTS.md` in the worktree belong to another
  tool and were left untouched and uncommitted.

## Research decisions

| Source                                                                                                | License / activity (GitHub API, 2026-11-17) | Decision        | Reason                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                             | no licence detected; active                 | WATCH           | no gap it fills today                                                                          |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)           | Apache-2.0; active                          | WATCH           | no plugin needed for this workflow                                                             |
| [anthropics/claude-code](https://github.com/anthropics/claude-code)                                   | active                                      | USE NOW         | the tool this build runs in; nothing imported                                                  |
| [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect)                           | BSD-3; active                               | WATCH           | ffmpeg `scdet` already finds cuts; would add Python/OpenCV                                     |
| [artbyjazi/autoclip](https://github.com/artbyjazi/autoclip)                                           | MIT; pushed 2026-08                         | WATCH           | speaker tracking may inform a later facecam/subject crop                                       |
| [modelscope/FunClip](https://github.com/modelscope/FunClip)                                           | MIT; active                                 | AVOID           | different ASR stack; whisper.cpp already works offline                                         |
| [Anil-matcha/AI-Youtube-Shorts-Generator](https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator) | MIT; active                                 | AVOID           | built around turning long-form YouTube videos into shorts; public-video reuse is out of policy |
| [nouverse/nouclip](https://github.com/nouverse/nouclip)                                               | MIT; 21 stars                               | AVOID           | early, same building blocks we have                                                            |
| [mifi/lossless-cut](https://github.com/mifi/lossless-cut)                                             | GPL-2.0; active                             | AVOID (as code) | desktop app; fine for Mike to use by hand, not to embed                                        |

No dependency was added.

## Human acceptance required

- Watch and score clips (rubric). Real-gameplay editorial acceptance is UNRUN.
- Verify the 9 unverified creator channel URLs before qualifying anyone.
- Legal review of the licence template before any use.
- Rights, Rockstar/Take-Two, music and platform decisions before publishing anything.

## Blockers and exact next steps

| Blocker                                                                | Resolution                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| No real authorized footage clipped yet                                 | Mike exports a PS5 session to `_inbox_footage/` and runs Clip a session    |
| Editorial quality unknown                                              | Mike scores clips with the rubric                                          |
| Stream (URL) clipper G1 never run on a real VOD                        | Mike supplies a real VOD URL and permission link; separate session         |
| Cancel takes effect between steps (bounded by the 15-min tool timeout) | later: cancellable ffmpeg/whisper calls                                    |
| Rockstar policy page timed out twice (2026-11-17)                      | re-read before any publication decision                                    |
| Platform connections                                                   | each needs Mike's separate approval, an app registration and review        |
| Promotion to the live Studio                                           | needs a backup and Mike's approval; would apply the 5 candidate migrations |

## Rollback

- Code: `git checkout feature/stream-clipper` (or tag `pre-clipper-complete-20261117`).
- Database (candidate only): `prisma/rollback/20261117194942_creator_rights.down.sql`
  on the 5433 database, after exporting any creator records you want to keep.
- The live Studio was never changed, so nothing there needs rolling back.

## Done criteria

Met for this milestone's software scope: the clipper runs end to end on real
video files, outputs reach the Library, rights and platform screens work as
internal records, all suites pass, the live Studio is untouched, rollback and
operator steps exist. Not met and not claimed: real-footage editorial
acceptance, rights clearance, any external connection, publication.
