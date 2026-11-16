# Completion build — explainer workflow, narration and render QA, jobs, review states

Branch `build/completion-20261115`, based on `dd82a4a`. **Not promoted**: the Studio of record on
port 3000 is unchanged. This build is served from this worktree on `http://127.0.0.1:3200` against
the disposable database `fgfinal_dev`. Publication stays blocked (`YOUTUBE_PUBLISHER=mock`).

Results, artefacts and hashes for the build are in `../completion_build_20261115/` (outside the
repository so they can name the final commit).

## Operator workflow: an explainer (title cards + narration)

1. **Sources / Claims**: register the official source, create the claims, mark them reviewed.
2. **Backlog** → create the content item → **Evidence** tab → link the reviewed claims.
3. **Production** tab → _Start an explainer (original graphics, no footage)_.
4. **Shorts pipeline** → _Write explainer script (title cards)_. One narration line per row, each
   followed by its card: `spoken sentence || LABEL :: STATEMENT :: note`. Write words the way they
   should be spoken (the system voice reads "Series X" as "Series ten"; "X|S" is read as letters).
5. _Synthesize voiceover_ → _Render 16:9_ and _Render 9:16_. Each render is checked automatically;
   a failure is shown with its reason and a _Retry_ button.
6. Watch and listen. The Owner approves one exact file by typing the first 8 characters of its
   SHA-256, or rejects it with a reason. Nothing here publishes.

Gameplay captures keep the existing flow (ingest → analyze → approve a cut → script → narrate → render)
and get the same QA, jobs and review states.

## What is checked automatically

| Stage     | Check                                             | Refuses when                                                                                      |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Narration | Clipping                                          | waveform flat against full scale                                                                  |
| Narration | Start, dead air, ending                           | >1 s lead-in; ≥1.5 s silence inside a line; audio still loud when it stops                        |
| Narration | Speech matches script (local whisper.cpp)         | a line is <70% heard, or word error rate >15%                                                     |
| Narration | Captions start with the speech                    | a caption is >0.35 s from its line's speech onset                                                 |
| Render    | Loudness (EBU R128)                               | outside −16 ±1 LUFS, or true peak above −1 dBFS                                                   |
| Render    | Narration under every line; speech matches script | a line is silent or not heard                                                                     |
| Render    | Picture                                           | black ≥1 s (explainers); a card without text; a caption not visible or too long for the safe area |
| Render    | File                                              | wrong size, no audio stream, wrong duration                                                       |

`NOT_VERIFIED` is recorded, never treated as a pass, when the speech model is missing; the draft is
then flagged **HUMAN LISTENING VALIDATION REQUIRED**. Every draft lists what still needs a person:
listening to the voice, and editorial accuracy.

## States

`MediaJob`: `QUEUED → RUNNING → SUCCEEDED | FAILED` (retryable). A draft exists once its render
passed QA: `RENDERED → QA_CHECKED → PENDING_MIKE_REVIEW` are stamped together in
`qaJson.stateHistory`; `reviewState` then rests at `PENDING_MIKE_REVIEW` until the Owner approves
that file (`MIKE_APPROVED`) or it is rejected (`REJECTED`). `UPLOADED`, `SCHEDULED` and
`PUBLISHED` do not exist for these drafts.

An Editor's _Record decision_ (existing control) is an editorial review. It does not set
`MIKE_APPROVED` and cannot make a draft publishable.

## Configuration

- `WHISPER_MODEL_PATH` — ggml model for `whisper-cli` (not in the repository).
- `SHORTS_EDITORIAL_MAX_SEC` — optional stricter 9:16 length.
- Requires macOS (`say`, Helvetica Neue), Homebrew `ffmpeg-full`, `whisper-cli`.

## Limits

- The system voice is synthetic. No voice quality judgement is automated.
- Transcription uses the `base.en` model: it can mishear a word (reported as a note) and its word
  times are coarse, which is why caption timing is anchored on silence boundaries.
- "Every card is on screen" checks that text is present in each card's time span, not that the
  text is the right text.
- Jobs run inside the request. A render that is interrupted by a server restart is taken over
  after 15 minutes, not resumed.
- The evidence, ledger-freshness and production-packet checks from the previous build still have
  no screens.
