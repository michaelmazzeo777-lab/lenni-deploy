import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Produces "Demonstration Video 001 (rebuilt)" through the Studio screens:
// source -> reviewed claims -> content -> explainer session -> script with
// title cards -> narration -> 16:9 draft -> native 9:16 draft.
//
// Safe to run again: every step first looks for what already exists, so a
// second run creates nothing and renders nothing.
//
// It signs in as the Editor and Producer demo accounts, never the Owner, and
// never approves, rejects or publishes anything. Both drafts are left at
// PENDING MIKE REVIEW.

const EDITOR = "editor@leonida.test";
const PRODUCER = "producer@leonida.test";
const PASSWORD = "demo-password-123";

const TITLE = "Demonstration Video 001 (rebuilt): what Rockstar's official GTA VI page says";
const SOURCE_TITLE = "Grand Theft Auto VI - official page (checked 2026-11-16)";
const PUBLISHER = "Rockstar Games";
const SOURCE_NOTES =
  "Retrieved 2026-11-16T08:49:46Z; page SHA-256 5f8117f24654f3715973fd4feb822996e7c9414a89d3f4cbff89233606dbf0ab. " +
  'Words found on the page as written: "Grand Theft Auto VI"; "November 19, 2026"; "PlayStation 5"; ' +
  '"Xbox Series X|S"; "Vice City"; "state of Leonida"; "Jason and Lucia"; "easy score goes wrong"; ' +
  '"rely on each other". One lineage: Rockstar Games\' own website. Re-check the page before any publication.';

const CLAIMS = [
  "Rockstar's official GTA VI page shows the release date November 19, 2026.",
  "Rockstar's official GTA VI page lists PlayStation 5 and Xbox Series X|S.",
  "Rockstar's official GTA VI page names Vice City and the state of Leonida.",
  "Rockstar's official GTA VI page describes Jason and Lucia as forced to rely on each other when an easy score goes wrong.",
];

const HOOK =
  "Grand Theft Auto Six. What Rockstar's official page says. || OFFICIAL PAGE :: GRAND THEFT AUTO VI :: What Rockstar's own page says";
const LINES = [
  "Everything here comes from Rockstar's official website, checked on November 16, 2026. || SOURCE :: rockstargames.com/VI :: Official website, checked November 16, 2026",
  "The release date shown is November 19, 2026. || RELEASE DATE :: NOVEMBER 19, 2026 :: As shown on the official page",
  "The platforms listed are PlayStation 5 and Xbox Series X|S. || PLATFORMS :: PlayStation 5 + Xbox Series X|S :: The two platforms listed",
  "The story is set in Vice City, and across the state of Leonida. || SETTING :: VICE CITY - STATE OF LEONIDA :: Named on the official page",
  "The official description centers on Jason and Lucia, who are forced to rely on each other when an easy score goes wrong. || NAMED ON THE PAGE :: JASON & LUCIA :: Forced to rely on each other when an easy score goes wrong",
  "Anything beyond that is not confirmed here. This is an independent fan guide, not affiliated with Rockstar Games. || EVERYTHING ELSE :: NOT CONFIRMED HERE :: Independent fan guide - not affiliated with Rockstar Games",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("Demonstration Video 001 (rebuilt): 16:9 and 9:16 drafts, left pending review", async ({
  page,
  browser,
}) => {
  const made: string[] = [];
  await signIn(page, EDITOR);

  // Source.
  await page.goto("/studio/sources");
  if ((await page.getByText(SOURCE_TITLE).count()) === 0) {
    await page.getByLabel("Title").fill(SOURCE_TITLE);
    await page.getByLabel("Publisher / owner").fill(PUBLISHER);
    await page.getByLabel("URL (optional)").fill("https://www.rockstargames.com/VI");
    await page.getByLabel("Source class").selectOption("OFFICIAL_SOURCE");
    await page.getByLabel("Source type").fill("official game page");
    await page.getByLabel("Factual as-of date").fill("2026-11-16");
    await page.getByLabel("Support notes / excerpt").fill(SOURCE_NOTES);
    await page.getByRole("button", { name: "Register source" }).click();
    await expect(page.getByText(SOURCE_TITLE).first()).toBeVisible();
    made.push("source");
  }

  // Claims, each tied to the source and marked reviewed.
  for (const claim of CLAIMS) {
    await page.goto("/studio/claims");
    const row = page.getByRole("row", { name: new RegExp(esc(claim)) });
    if ((await row.count()) === 0) {
      await page.getByLabel("Exact claim").fill(claim);
      await page.getByLabel("Classification").selectOption("CONFIRMED");
      await page
        .getByLabel("Supporting sources")
        .selectOption({ label: `${PUBLISHER}: ${SOURCE_TITLE} [OFFICIAL_SOURCE]` });
      await page.getByRole("button", { name: "Create claim" }).click();
      await expect(row).toHaveCount(1);
      made.push("claim");
    }
    if (!(await row.innerText()).includes("REVIEWED")) {
      await row.getByRole("button", { name: "Mark reviewed" }).click();
      await expect(row).toContainText("REVIEWED");
      made.push("claim review");
    }
  }

  // Content item.
  await page.goto("/studio/content");
  const existing = page.getByRole("link", { name: TITLE });
  if ((await existing.count()) === 0) {
    await page.getByLabel("Working title").fill(TITLE);
    await page.getByRole("button", { name: "Create idea" }).click();
    made.push("content");
  } else {
    await existing.first().click();
  }
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0]!;

  // Explainer session, started by the Producer.
  const producerCtx = await browser.newContext();
  const producer = await producerCtx.newPage();
  await signIn(producer, PRODUCER);
  await producer.goto(`${contentUrl}?tab=production`);
  const session = producer.getByRole("row", { name: /None - original graphics/ });
  if ((await session.count()) === 0) {
    await producer.getByRole("button", { name: /Start an explainer/ }).click();
    made.push("explainer session");
  }
  await expect(session).toHaveCount(1);
  await producerCtx.close();

  // Link the reviewed claims to the content.
  for (const claim of CLAIMS) {
    await page.goto(`${contentUrl}?tab=evidence`);
    const cell = page.getByRole("cell", { name: new RegExp(esc(claim.slice(0, 50))) });
    if ((await cell.count()) === 0) {
      await page
        .getByLabel("Reviewed claim")
        .selectOption({ label: `[CONFIRMED] ${claim.slice(0, 60)}` });
      await page.getByRole("button", { name: "Link claim" }).click();
      await expect(cell).toBeVisible();
      made.push("claim link");
    }
  }

  // Script with title cards.
  await page.goto("/studio/shorts");
  const card = page.locator(".card").filter({ hasText: TITLE }).filter({ hasText: "Hook:" });
  if ((await card.count()) === 0) {
    const row = page.getByRole("row", { name: new RegExp(esc(TITLE)) });
    await row.getByText("Write explainer script (title cards)").click();
    await row.getByLabel("Hook (with its card)").fill(HOOK);
    await row.getByLabel(/Explainer lines/).fill(LINES.join("\n"));
    await row.getByRole("button", { name: /Save explainer script/ }).click();
    await expect(card).toHaveCount(1);
    made.push("script");
  }
  await expect(card.getByText("VALID")).toBeVisible();

  // Narration (system voice), checked against the script by the Studio.
  if ((await card.getByText(/Voiceover: shorts\/voiceover\//).count()) === 0) {
    await card.getByRole("button", { name: /voiceover \(local-say-fixture\)/ }).click();
    await expect(card.getByText(/Voiceover: shorts\/voiceover\//)).toBeVisible({
      timeout: 180_000,
    });
    made.push("narration");
  }

  // Renders: one per format, never a second.
  for (const [format, size] of [
    ["16:9", "1920x1080"],
    ["9:16", "1080x1920"],
  ] as const) {
    if ((await card.getByText(`Render ${size}`).count()) === 0) {
      await card
        .getByRole("button", { name: new RegExp(`ender ${format} \\(local-ffmpeg\\)`) })
        .click();
      await expect(card.getByText(`Render ${size}`)).toBeVisible({ timeout: 300_000 });
      made.push(`render ${format}`);
    }
  }

  // What must be true however many times this has run.
  await expect(card.locator("video")).toHaveCount(2);
  await expect(card.getByRole("button", { name: /Render (9:16|16:9)/ })).toHaveCount(0);
  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(2);
  await expect(card.getByText("MIKE APPROVED")).toHaveCount(0);
  await expect(card.getByText("ILLUSTRATIVE DRAFT — not gameplay")).toHaveCount(2);
  await expect(card.getByText("Automatic QA: all checks passed")).toHaveCount(2);
  await expect(card.getByRole("button", { name: "Approve this version" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Publish/ })).toHaveCount(0);

  // Both masters decode and play in the browser at their native size.
  const playback = [];
  for (const i of [0, 1]) {
    const video = card.locator("video").nth(i);
    await video.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    playback.push(
      await video.evaluate(async (v: HTMLVideoElement) => {
        v.muted = true;
        await v.play();
        await new Promise((r) => setTimeout(r, 2000));
        v.pause();
        return {
          src: v.currentSrc,
          width: v.videoWidth,
          height: v.videoHeight,
          durationSec: v.duration,
          playedSec: v.currentTime,
          audioBytesDecoded:
            (v as unknown as { webkitAudioDecodedByteCount?: number })
              .webkitAudioDecodedByteCount ?? null,
        };
      }),
    );
  }
  for (const p of playback) expect(p.playedSec).toBeGreaterThan(0.5);

  const summary = {
    createdThisRun: made,
    contentUrl,
    playback,
    sha256: (await card.getByText(/^SHA-256:/).allInnerTexts()).map(
      (t) => /[0-9a-f]{64}/.exec(t)?.[0],
    ),
    links: await card
      .getByRole("link")
      .evaluateAll((as) => as.map((a) => [a.textContent?.trim(), (a as HTMLAnchorElement).href])),
  };
  if (process.env.PRODUCTION_SUMMARY_PATH) {
    await writeFile(process.env.PRODUCTION_SUMMARY_PATH, JSON.stringify(summary, null, 2));
  }
  console.log(`created this run: ${made.length ? made.join(", ") : "nothing"}`);
});
