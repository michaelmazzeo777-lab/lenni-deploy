# Premium engine — what this folder is and where it came from

Vendored on 2026-11-17 from `fgs_premium_001_final_capability_20261116/engineering` (left untouched).
Changes made here: `drop_in_voice.py` gained `--runs-dir` and `--line-times` and requires `--episode`/`--export`;
`fgs/align.py` accepts known line times. The Studio calls it through `lib/premium/`.

## Assets in `assets/` — INTERNAL USE ONLY, RIGHTS OPEN

| File                      | Stated origin                                                    | Evidence                                                          | Rights                             |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `generated-env-*.jpg` (9) | "OpenAI image generation", 2026-11-16, per the Motion V2 package | File names only; source sheets, prompts and account record absent | OPEN - not cleared for publication |
| `sound-bed.wav`           | "original, voice-free ambient audio" per the package README      | No generating script                                              | OPEN - origin is a statement only  |

Nothing rendered with these assets may be published until their rights are reviewed. The Studio records
this status in every premium render's manifest and blocks publication of illustrative drafts.

## Runtime needs (not in the repo)

A Python with Pillow (`PREMIUM_PYTHON`), ffmpeg, whisper-cli with a model (`WHISPER_CLI_PATH`,
`WHISPER_MODEL_PATH`), and two font files (`PREMIUM_FONT_REGULAR`, `PREMIUM_FONT_BOLD`).
