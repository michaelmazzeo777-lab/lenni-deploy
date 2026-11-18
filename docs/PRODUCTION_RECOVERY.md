# Production recovery checkpoint — 2026-11-17

PROJECT: Welcome to Leonida. PURPOSE: one existing Studio producing an internal long-form guide and two supporting Shorts. STAGE: actual production proof running. VERIFIED BASE: 40ec9d9992eec475192b9bdc3cb8ad68bb09fa4b. BRANCH: build/replacement-production-20261117. APPROVAL: local isolated engineering only; publication and PS5 control disabled.

## Recovered and preserved

- Mature Next Studio, clipper, claims/freshness, source ledger, graphics/narration, media QA, jobs, review/export, rights and platform records: original candidate at `~/Welcome to Leonida/leonida-final-candidate`, commit above. Historical evidence: receipt 22, 400 unit/integration and 13 browser tests. New work does not convert historical results into newly run tests.
- Original Studio: recovery/fable-052 at dd82a4a, untouched.
- Replacement-first v0.1 archive SHA256 e70013d20db2bbb8aab1b1979a9aae94248ea8130ad576e47e950c01faad0271; v0.2 archive SHA256 0a01d3615a9b471122455847eccfb0f4daf89263ef0902624c00f5ca1d48c00d. Extracted under `~/Welcome to Leonida/replacement_production_20261117/sources/` with originals retained. Python stdlib/SQLite server, FFmpeg adapter, simple clipper, research handoff, browser scripted play lab and unexecuted Godot experiment recovered. The Python proof worker can silently omit narration and lacks Studio transcription QA; not substituted for working production code.
- Research helper: adapted the recovered deterministic question/evidence handoff into authenticated workspace-scoped Studio search. It does not perform live fact verification or model inference. Original specialist files and play-lab source remain preserved in the recovery archive; play lab is not console automation or verified independent gameplay.
- Canonical files 01–20 and proposed document 21 unchanged. No media or approval copied into the new proof database.

## Engine decision (official source inspected 2026-11-17)

- Keep installed FFmpeg-full 9.0.2 and whisper.cpp 1.9.5, existing real subprocess adapters. Local licence approval retained; distribution review still required.
- OpenShorts `9354774bac7b59f26ef5b5a6a13e6558b82181d6`, official https://github.com/mutonby/openshorts, MIT. Requirements and Dockerfile inspected. Docker daemon is unavailable; host has 8 GiB RAM and about 10 GiB free. Official local-model instructions require 16K context and say 3B models do not reliably return JSON; available 7B model alone is 4.7 GB, before Docker/torch/vision/ASR/Studio. No cloud key/account authorized. Use existing FFmpeg/whisper clipper fallback. OpenShorts actual-media/HUD test NOT_TESTED; no claim it was integrated or inferior in measured quality.
- MakeMyClip `e090b420f2f0c2c5fd4b16d3b741348fdd6d8671`, official https://github.com/MakeMyClip/editor. Conditional, deferred: recovered Studio already provides required production/render/clip/export functions; no demonstrated essential timeline gap. No install or invocation claimed.
- No paid services, external publishing integrations or new accounts connected.

## Isolation and rollback

Managed worktree: `~/.codex/worktrees/leonida-production/leonida-final-candidate`; new database `localhost:5433/fgprod_dev`, separate `.data/storage` and `.data/ingest`. Existing candidate server remains on 3400; this review server is 127.0.0.1:3500. No schema changes beyond applying the existing migrations to the newly created empty database. Three local demo users created only in that empty proof workspace; no approval seeded.

Read-only candidate backup: `~/Welcome to Leonida/replacement_production_20261117/candidate-before.dump`, mode 600, pg_restore catalog checked. Baseline source tar retained beside it. Restore is unnecessary for original apps: they are unchanged. Stop only the isolated 3500 server to cease using this candidate; retain its database, source and media. Never apply rollback/drop commands to 5432 or fgcand_dev.

## Acceptance still to collect

Real UI production run, file/QA/frame receipts, two distinct clips, repeat/persistence and error recovery evidence. Original long-form script is a proposed gameplay-testing methodology, not verified GTA mechanics. All new render/clip outputs must remain PENDING_MIKE_REVIEW. Human listening/editorial acceptance is separate from technical proof.
