# Local Studio Completion Record — 2026-11-15

**Software state:** `LOCAL_STUDIO_COMPLETE` (internal local use) · **Release state:** `PUBLICATION_BLOCKED`
**Branch:** `recovery/fable-052` · **Base:** `713431b` · Test results and the final commit are in
`../RESUME_HERE.md` and `../FINAL_CHANGE_MANIFEST.txt` (kept outside the repo so they can name the final commit).

Every output so far is an **internal technical fixture** (synthetic test footage, macOS system
voice). Nothing here is GTA VI gameplay and nothing is publishable.

## Run it

```sh
cd "/Users/michaeljmazzeo/Welcome to Leonida/leonida-field-guide-recovery"
pnpm studio            # starts the project-local database, then the app on http://localhost:3000
```

- First time after a code change: `pnpm build` before `pnpm studio`.
- Sign in at `/signin` with a seeded demo account (listed in `README.md`).
- `pnpm studio` binds to `127.0.0.1` only. Do not use `pnpm start` on a shared network: it
  listens on every interface and the sign-in page shows the demo password.
- Stop: Ctrl-C, then `sh scripts/dev-db.sh stop`.
- **Never run `pnpm db:seed` on this database** — it truncates every table.

## Operator workflow

1. **Backlog** → create an idea → **Production** tab → _Submit capture footage_ (tick _Candidate
   for Shorts pipeline_) → _Review_ to approve the capture.
2. Copy the video into `.data/ingest/` (PS5: Create → save recent gameplay → Media Gallery → copy
   to USB → copy to the Mac).
3. **Capture intake** → _Attach video_ (operator, method, rights) → _Analyze highlights_ →
   approve / reject / trim each cut.
4. **Shorts pipeline** → _Write script_ for an approved cut → _Synthesize voiceover_ →
   _Render 9:16_ / _Render 16:9_ → play it, download the review bundle, record a decision.
5. For real narration: put the recording in `.data/ingest/` and set
   `TTS_PROVIDER="operator-recording"` in `.env`.

## Verification

Commands, counts, timestamps and commit are recorded in `../RESUME_HERE.md`. Summary of what the
suites cover:

| Area                   | Evidence                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Unit + integration     | `pnpm test` (Vitest, test database `fieldguide_test`)                                                       |
| Browser                | `pnpm test:e2e` (Playwright; mock server on 3100, local-pipeline server on 3101, database `fieldguide_e2e`) |
| Static                 | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:secrets`, `pnpm build`                       |
| Review-fix regressions | `tests/integration/local-media.test.ts` → "regressions for the review fixes"                                |

The narration-too-long regression sets the stored narration length above the clip length; it does
not synthesize a genuinely long narration. The 60-second Shorts ceiling branch is the same check
but is not exercised with a clip longer than 60 s.

## Security regression gate

| Control                                | Verified by                                                                                                                                             | Result |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Authentication, protected routes       | e2e "anonymous users cannot enter the studio"; e2e anonymous media fetch; live `curl`: `/studio/captures` 307, media 401, export 401                    | pass   |
| Sign-in throttling                     | `auth-throttle` integration + e2e                                                                                                                       | pass   |
| Workspace ownership, existing features | `storage.test` (other-workspace asset), `distributed-production.test` negative controls                                                                 | pass   |
| Workspace ownership, new features      | `local-media.test` "workspace isolation…": other workspace's Owner gets NOT_FOUND on attach, analyze, review cut, draft, render, review render, publish | pass   |
| Cross-workspace media access           | same test: `resolveMediaTarget` returns nothing for the other workspace and for a same-workspace Read Only user                                         | pass   |
| Last-Owner protection                  | `growth.test` "refuses to remove the last Owner"                                                                                                        | pass   |
| Atomic workflow transitions            | `workflow-race.test`                                                                                                                                    | pass   |
| Approval integrity                     | `pipeline.test` "a material script edit invalidates prior approvals"                                                                                    | pass   |
| Append-only audit, immutable revisions | `pipeline.test` (DB triggers)                                                                                                                           | pass   |
| Export scope                           | new test: another workspace's exports contain none of this workspace's rows; unauthenticated export 401                                                 | pass   |
| Capture intake validation              | `local-media.test`: traversal, symlink, non-video, placeholder MP4, duplicate SHA-256                                                                   | pass   |
| No unintended publication              | `YOUTUBE_PUBLISHER=mock`; non-mock selection throws (`shorts.test`); fixture renders refuse publish (integration + e2e + live)                          | pass   |
| No console automation                  | no PSN, OBS, console or account code exists in `app/`, `domain/`, `lib/`, `scripts/`                                                                    | pass   |
| Earlier security commits present       | `2fb14a2`, `e418780`, `713431b` are ancestors of HEAD                                                                                                   | pass   |

**Found and fixed during this gate**

- A double submit of the same file could delete the stored video (introduced by the earlier
  review fix; caught by the new regression test before it shipped anywhere).
- The documented start command exposed the app to the local network. `pnpm studio` now binds to
  `127.0.0.1`.

**Known, not critical**

- Exports require sign-in and are workspace-scoped, but any signed-in member of the workspace
  (including Contributor and Read Only) can export content, claims, sources and audit. This
  matches what those roles can already read on screen; tighten it before adding outside users.
- Demo accounts share one seeded password. Change or remove them before anyone else uses the app.
- No rollback of the database migration was exercised (see Rollback).

## Outputs (all internal fixtures)

Under `.data/storage/shorts/render/`; each folder holds `master.mp4`, `captions.srt`,
`transcript.txt`, `cover.jpg`, `manifest.json`, `bundle.zip`. Paths, sizes and SHA-256 are in
`../FINAL_CHANGE_MANIFEST.txt`. On-disk hashes were rechecked against the database records.

## Measurements (this Mac, Apple M2)

| Item                                                           | Observed                                              |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| Highlight analysis, 60 s 720p clip (live app, audit log)       | 892 ms and 1,328 ms                                   |
| Re-analysis with nothing new to add                            | 598 ms                                                |
| Highlight analysis in the benchmark script (60–75 s clips)     | 726–1,006 ms                                          |
| 9:16 render, 12 s master, click to finished bundle (live app)  | 8.2 s                                                 |
| Three renders (two 9:16, one 16:9) inside the integration test | 27–32 s total                                         |
| Master size, 11–12 s at 1080p                                  | 15.4–18.0 MB (about 11–12 Mbit/s)                     |
| Full unit + integration suite                                  | about 58 s                                            |
| Full browser suite                                             | about 35 s                                            |
| Model/API cost of the app                                      | $0 — no AI or paid API is called (`AI_PROVIDER=mock`) |
| Operator minutes per finished Short                            | UNKNOWN — no real production run yet                  |
| CPU / memory during render                                     | UNKNOWN — not captured                                |
| Claude Code usage for this build                               | UNKNOWN — not measured here                           |

Operational errors seen: Postgres refused to start without `LC_ALL` (fixed in `dev-db.sh`);
Playwright expected a newer Chromium than the one installed (use `PW_CHROMIUM_PATH`).
`.data/storage-test` grows with every test run and can be deleted at any time.

## Dependencies added on this Mac (Homebrew)

| Package         | Version | Used for                                                                                                          |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `postgresql@16` | 16.16   | The app's database. Runs only when started by `scripts/dev-db.sh`, data in `.data/pg`, listens on localhost only. |
| `ffmpeg`        | 9.0.2   | Installed first. **Not used by the app** once `ffmpeg-full` is present.                                           |
| `ffmpeg-full`   | 9.0.2   | Used for all probing, analysis, narration conversion and rendering.                                               |

**`ffmpeg-full` review**

- _Why:_ Homebrew's standard `ffmpeg` is built without libass/freetype, so it has no `ass`,
  `subtitles` or `drawtext` filter. The renderer burns captions, the attribution line and the
  fixture warning with the `ass` filter.
- _Dependency:_ yes. `lib/media/ffmpeg.ts` prefers `/opt/homebrew/opt/ffmpeg-full/bin`, then
  `PATH`; `FFMPEG_PATH` / `FFPROBE_PATH` override. With only the standard build, analysis works
  but every render fails.
- _Authorization:_ Mike approved "`brew install postgresql@16 ffmpeg`". `ffmpeg-full` was
  installed afterwards **without separate approval**. That was a deviation; it is recorded here,
  not retroactively approved.
- _Licence:_ this build is GPL-3.0-or-later (`--enable-gpl --enable-version3`, with x264/x265);
  it is not a "nonfree" build. The Studio runs it as a separate program and does not bundle or
  link it, so the Studio's own code is unaffected and rendered videos are not covered by the GPL.
  Shipping the Studio to others with FFmpeg included would bring GPL obligations. H.264/AAC
  patent licensing for commercial distribution is a separate question for whoever reviews
  release rights. This is an engineering note, not legal advice.
- _Security:_ FFmpeg parses untrusted media and has a long history of parser bugs. Here it only
  reads files the operator placed in the ingest folder, runs as the local user, and receives
  arguments as an array (no shell). It pulled in 47 Homebrew dependencies. Keep it updated with
  `brew upgrade`; do not point it at files from unknown sources.
- _Future action (Mike's call, none taken):_ either accept `ffmpeg-full` as the renderer
  dependency, or have it removed (`brew uninstall ffmpeg-full`), which disables rendering.
  The unused standard `ffmpeg` can be removed without effect on the app.

## Claims and pilot queue

- Canonical taxonomy adapter and stale-claim gate: see `CHANGELOG.md` (`4436a30`) and
  `tests/unit/canonical-taxonomy.test.ts`. The canonical ledger (references 01–20) is unchanged;
  hashes still match `handoff_v2_0/MANIFEST_SHA256.csv`.
- `../21_Pilot_Content_Queue_v1_0.md`: four long-form and eight Shorts, scored, with rejected and
  deferred candidates and a proposed first long-form plus two Shorts. The twelve titles in the
  Studio backlog match the document one for one. **PROPOSED — pending Mike's editorial review.**

## Rollback

- The original checkout `/Users/michaeljmazzeo/lenni-deploy` is untouched at `713431b`, clean.
- Code: `git -C leonida-field-guide-recovery checkout 713431b` returns this copy to the July code;
  `git checkout recovery/fable-052` returns to the current build. Each commit in `CHANGELOG.md`
  is also a valid restore point.
- Database: the one new migration only adds tables and columns. July code runs against the
  migrated database but was **not** re-tested there. For a clean July state, start a fresh
  database instead of reversing the migration.
- Full removal: delete `leonida-field-guide-recovery/`; optionally
  `brew uninstall postgresql@16 ffmpeg ffmpeg-full`.

## Still required before anything is published

Genuine authorized gameplay footage with accepted capture provenance; human-quality narration or
an approved alternative; human recheck of every claim (all GTA VI ledger claims are past their
freshness window); rights and trademark review; captions and accessibility QA; final master
review; Mike's exact approval; platform permissions.
