# Moment-picking rubric — stream clipper

Rubric version: **1** (set `rubricVersion: 1` in `picks.json`).

You are picking clippable moments out of a long GTA 6 livestream VOD. You read
the chunk files in the run's `chunks/` folder and write one `picks.json`. You do
not render anything, and nothing you write is published — every clip lands in
Library review for the owner to approve or reject.

## What you are given

One markdown file per 12-minute window, with 60 seconds of overlap between
consecutive files, so a moment that straddles a boundary appears whole in one of
them. Each file carries:

- audio-energy peaks (normalised 0–1),
- chat-rate spikes (only when the stream had a chat replay),
- the transcript, as `**[mm:ss]**` lines in **absolute stream time**.

Energy and chat are hints about where to look, not reasons on their own. A loud
moment with nothing happening is not a clip.

## Output contract

Write exactly this shape. Unknown keys are rejected; so are out-of-range
numbers, and a `total` that does not equal `energy + shareability`.

```json
{
  "runId": "<the runId printed by the prepare step>",
  "rubricVersion": 1,
  "picks": [
    {
      "start": 1434.0,
      "end": 1462.5,
      "category": "reaction",
      "hook_title": "He did not expect that payout",
      "why": "Cold-opens on the reaction; the stake is obvious from the screen alone.",
      "standalone": true,
      "energy": 8,
      "shareability": 9,
      "total": 17
    }
  ]
}
```

- `start` / `end` — absolute stream seconds, copied from the chunk timestamps.
  **Length must be between 15 and 60 seconds.** Anything outside is refused.
- `category` — one of `reaction`, `skill`, `fail`, `funny`, `story`,
  `discovery`, `banter`.
- `hook_title` — 3–80 characters, burned over the opening seconds. Describe what
  the viewer is about to see. No clickbait framing of something that does not
  happen, no invented numbers.
- `why` — 10–500 characters, your actual reason.
- `standalone` — see the harsh test below.
- `energy`, `shareability` — integers 1–10. `total` must be their sum.

Overlapping picks are allowed in the file; the clipping step keeps the
better-scoring one and drops the other. Picks that fail `standalone` are
dropped entirely, so do not set it to `true` to get a moment through.

## Be harsh

Most of a stream is not clippable. Returning three good picks out of four hours
is a success; returning twelve mediocre ones is a failure. Reject a candidate if
any of these is true:

- **It needs context.** If the viewer must have seen the preceding few minutes
  to understand why it matters, it is not standalone. Set `standalone: false`.
- **It opens on filler.** "Um", "so anyway", "like I was saying", dead air, a
  sentence already in progress, or a menu screen. The first second has to land.
- **The payoff is off-screen or implied.** Reacting to something the clip never
  shows does not survive the crop.
- **It is only loud.** Energy spikes track volume, not interest.
- **It is a repeat.** Near-identical beats across a long stream: pick the best
  one and leave the rest.
- **It needs a cut to work.** Clips are one continuous range. If it only works
  with the boring middle removed, it is not a pick.

## Never invent

- Do not write a `hook_title` or `why` containing a quote that is not in the
  transcript, verbatim.
- Do not guess at what happened visually. You have the transcript, energy, and
  chat only — if the transcript does not support the moment, do not claim it.
- If the transcript is sparse or garbled in a window, say so by simply not
  picking from it. An empty `picks` array is refused by the schema, so if the
  whole stream yields nothing, report that in chat instead of padding the file.

## Boundaries

Pick generous boundaries on a natural speech edge: start just before the first
word of the moment, end just after the last. The clipping step snaps both
boundaries to a nearby silence or scene cut and will never cut mid-word, so a
boundary landing a beat early or late is corrected — but it only searches within
about 1.5 seconds, and it clamps anything outside 15–60s. Do not rely on it to
fix a badly chosen range.
