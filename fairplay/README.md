# FairPlay — Every Kid Plays 🏟️

**The volunteer coach's game-day autopilot.** Take attendance in 10 seconds, get a
provably fair rotation for any youth sport, run the live clock while it tracks every
kid's real playing time, and send parents a fairness report they can't argue with.

Built for the sideline: works **fully offline** (installable PWA), thumb-sized buttons,
dark high-contrast UI readable in the sun, zero accounts, zero servers — data stays on
the coach's phone.

## Why people will pay for this

Every rec league in America promises "every kid plays." No coach can actually prove it,
and every coach has had the parent counting minutes from the bleachers. FairPlay turns
that confrontation into a shareable **equity score** after every game — and its rotation
engine remembers season-long minutes, so a kid who got shorted last week automatically
starts first this week.

- **Buyer #1 — leagues & franchises (B2B, the real money):** white-label license per
  location/season. A franchise operator (like i9 Sports) hands it to every volunteer
  coach; the fairness report *is* marketing for the league's brand promise.
- **Buyer #2 — individual coaches (B2C):** free single team, one-time or seasonal
  unlock for multiple teams and season analytics.
- **Buyer #3 — tournament operators:** equity reporting as a rules-compliance tool
  (many rec rules mandate minimum play time).

## Features (working today)

- Multi-team, multi-sport: soccer, flag football, basketball, baseball/t-ball,
  volleyball, hockey, or fully custom (players-on-field × periods × minutes).
- Tap-to-toggle attendance, then a one-tap fair rotation:
  - appearances within the game differ by at most 1 across kids,
  - nobody sits two periods in a row (when mathematically possible),
  - ties broken by lowest **season** minutes → automatic cross-game catch-up.
- Live game screen: countdown clock per period, on-field vs bench, tap-tap
  substitutions, real seconds credited only while the clock runs. Survives the phone
  locking or the browser being backgrounded.
- Post-game report: 0–100 equity score, Gold/Silver/Bronze Whistle badge, per-kid
  minutes bars, one-tap share to the parent group chat.
- Season dashboard: total minutes per kid, average equity, tappable game log.
- JSON export/import backup, demo team for instant sales demos.

## Run it

It's a static site — no build step, no dependencies.

```sh
cd fairplay
python3 -m http.server 8080   # or any static server
# open http://localhost:8080
```

Deploy by pointing GitHub Pages, Netlify, Vercel, or Cloudflare Pages at this folder.
On a phone, use "Add to Home Screen" to install it like a native app.

## Test the engine

```sh
node tests/engine.test.js
```

## Roadmap to v1.0 (sellable next steps)

1. Position rotation (GK/QB fairness, not just field time).
2. League admin dashboard: aggregate equity scores across all teams (the white-label upsell).
3. Stripe paywall for multi-team unlock; license keys for leagues.
4. Photo-free player cards parents can share ("Maya played 31:40 today 🥇").
