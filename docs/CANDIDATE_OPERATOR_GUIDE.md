# Field Guide Studio — final candidate: operator guide

Internal use only. **Nothing here publishes.** The baseline Studio (port 3000) is separate and untouched.

## Start and stop

```bash
sh scripts/start-candidate.sh
```

Open `http://127.0.0.1:3300`. Sign-in details are on the sign-in page. Stop the Studio with Ctrl-C. To stop the candidate's database as well:

```bash
sh scripts/start-candidate.sh stop
```

The candidate uses only its own folder: database on port 5433 (`.data/pg`), media in `.data/storage`.

## Make a video from sourced content (premium render)

1. **Research → Sources**: register the source.
2. **Research → Claims**: write the claim, pick its source, **Mark reviewed**.
3. **Content → Backlog**: create the content item.
4. On the content item, **Evidence** tab: link the reviewed claim. **Production** tab: **Start an explainer**.
5. **Production → Shorts pipeline**: on the content's row, **Write explainer script**. One line per scene:
   `what the voice says || SMALL HEADING :: MAIN STATEMENT :: supporting note`
   Each scene needs about four seconds of speech or more.
6. **Synthesize voiceover**, then **Start premium render**. The panel shows what the job is doing and refreshes itself. You can leave the page. **Cancel premium render** stops it; **Retry premium render** runs it again.
7. **Production → Library & review**: play both formats, read the evidence, asset rights and QA, then **Approve internally** (Owner only: type the first 8 characters of the file's SHA-256) or **Request revision**.

## Make a video from footage (standard render)

1. Put the video file in the capture intake folder, then **Production → Capture intake**: submit, attach, have it approved.
2. **Analyze highlights**, approve a cut.
3. **Shorts pipeline**: write the script, synthesize the voiceover, render 9:16 or 16:9.
4. Review it in **Library & review**.

Footage must be your own capture or be labelled as a fixture. A fixture can never be published.

## What the states mean

| Job       | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| RUNNING   | Working. The text beside it says which step.                   |
| SUCCEEDED | Both files are stored and listed.                              |
| FAILED    | The reason is shown. Fix it if it names a problem, then retry. |
| CANCELED  | You stopped it. Retry when ready.                              |

If the Studio is restarted while a job is running, the job is shown as FAILED with "Interrupted" the next time the page loads. Retry it.

| Video                    | Meaning                                                     |
| ------------------------ | ----------------------------------------------------------- |
| PENDING MIKE REVIEW      | Passed automatic checks. Waiting for the Owner.             |
| MIKE APPROVED (internal) | The Owner approved that exact file. Internal only.          |
| REVISION REQUESTED       | Sent back. The file is no longer served; render again.      |
| PUBLICATION BLOCKED      | Always shown. Publishing is not available for these videos. |

## Rollback

The baseline is unchanged, so there is nothing to roll back. To set the candidate aside, stop it and leave the folder. The baseline starts with its own launcher from `leonida-field-guide-recovery`.

## Needs on this Mac (not in the repo)

ffmpeg, whisper-cli with its model (`WHISPER_MODEL_PATH`), a Python with Pillow (`PREMIUM_PYTHON`), two font files (`PREMIUM_FONT_DIR`), and the macOS `say` voice. The Shorts pipeline page says so if the premium engine is not ready.
