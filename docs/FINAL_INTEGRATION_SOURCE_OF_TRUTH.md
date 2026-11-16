# Final integration — source of truth

Working engineering record for the `integration/final-v1` candidate. Not a canonical project source.
Status: **FINAL_INTEGRATION_READY_FOR_MIKE_APPROVAL** · Publication: **PUBLICATION_BLOCKED** ·
Not merged, pushed, deployed or published.

## Verified inputs (2026-11-15)

| Item                    | Value                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Frozen baseline         | `leonida-field-guide-recovery`, `recovery/fable-052` at `9c36c88`; tag `local-studio-complete-2026-11-15` → `2f43873` |
| Gemini candidate        | `gemini/candidate-v3.1` at `485b71e`, parent `9c36c88`, clean; a worktree of `~/lenni-deploy`                         |
| Gemini patch            | identical to the commit diff; SHA-256 `8fbed21c452b77eae9d4726f5de32e0b6af837ff6299378c242d8850e22501f8`              |
| Gemini handoff manifest | 29 of 29 files verify                                                                                                 |
| This candidate          | worktree `leonida-final-integration`, branch `integration/final-v1`, based on `9c36c88`                               |
| Tested code commit      | `807d97b` (later commits on this branch are documentation only: `git diff 807d97b..HEAD --stat`)                      |

## Decisions

Full table with evidence: `../final_integration_v1/INTEGRATION_DECISIONS.md`.

- Caption/transcript contract: adapted, and wired into the render path.
- 60 s Shorts ceiling: corrected to the 180 s platform limit, optional stricter editorial limit.
- Highlight scorer changes: deferred, experimental, off by default.
- OBSERVED_IN_GAME check, ledger freshness, production packet: adapted to read Studio records.
- Sandbox: isolated, disabled by default, model inference NOT VERIFIED, PS5 control disabled.

## Environment

- Databases (same local Postgres server, separate from the frozen Studio's): `fgfinal_dev`,
  `fgfinal_test`, `fgfinal_e2e`. No schema change; no new migration.
- Output: this worktree's own `.data/`.
- `.env` here points at those databases. **The browser suite wipes its database**: it now refuses
  to run unless `E2E_DATABASE_URL` is set.
- Renderer: Homebrew `ffmpeg-full` 9.0.2 (approved for local use; not for distribution).
- No package, service, account or credential was added.

## Tests executed on `807d97b`

| Command                                                  | Result            |
| -------------------------------------------------------- | ----------------- |
| `pnpm format:check`, `lint`, `typecheck`, `test:secrets` | pass              |
| `pnpm test`                                              | 23 files, 151/151 |
| `pnpm build`                                             | pass              |
| `pnpm test:e2e`                                          | 9/9, no retries   |

Details and logs: `../final_integration_v1/TEST_EVIDENCE.md`, `../final_integration_v1/logs/`.

## Resume commands

```sh
cd "/Users/michaeljmazzeo/Welcome to Leonida/leonida-final-integration"
set -a; . ./.env; set +a
pnpm test
pnpm build
PW_CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell pnpm test:e2e
```

## Open items

- Mike's decision on whether this candidate replaces the frozen baseline.
- Highlight ranking is still unmeasured on real footage; the experimental filter needs a real
  measured signal before it can be considered.
- Sandbox model inference has never been run.
- Everything listed as open in `../RESUME_HERE.md` (real capture, real narration, claim recheck).

## Definition of done

Baseline preserved; Gemini's source inspected; each change adopted, adapted, deferred or rejected
with evidence; full suite, build and browser tests pass on the candidate commit; Studio workflow
demonstrated; media verified; sandbox limits stated; manifest and rollback written; no external
action taken.

## References consulted (2026-11-15)

Only the YouTube Shorts length rule was needed, and it was taken from the directive's source
register (support.google.com/youtube/answer/15424877 and /6013276) without a fresh fetch: three
minutes for vertical or square Shorts; a Short over one minute with an active Content ID claim is
blocked. Recheck before relying on it for publication.
