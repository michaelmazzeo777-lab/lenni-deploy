import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Operator run on a live Studio: makes one premium video from sourced content
// through the screens, as the Editor and Producer demo accounts. Never signs in
// as the Owner; never approves, rejects or publishes. Safe to run again: each
// step first looks for what already exists.

const EDITOR = "editor@leonida.test";
const PRODUCER = "producer@leonida.test";
const PASSWORD = "demo-password-123";
const TITLE = "Premium demo: what Rockstar's official GTA VI page says";
const SOURCE_TITLE = "Grand Theft Auto VI - official page (checked 2026-11-16)";
const PUBLISHER = "Rockstar Games";
const CLAIMS = [
  "Rockstar's official GTA VI page shows the release date November 19, 2026.",
  "Rockstar's official GTA VI page lists PlayStation 5 and Xbox Series X|S.",
  "Rockstar's official GTA VI page names Vice City and the state of Leonida.",
  "Rockstar's official GTA VI page describes Jason and Lucia as forced to rely on each other when an easy score goes wrong.",
];
const HOOK =
  "Grand Theft Auto Six: here is what Rockstar's official page says, checked on November sixteenth. || OFFICIAL PAGE :: GRAND THEFT AUTO VI :: What Rockstar's own page says";
const LINES = [
  "The release date shown on the official page is November nineteenth, twenty twenty-six. || RELEASE DATE :: NOVEMBER 19, 2026 :: As shown on the official page",
  "The platforms listed there are PlayStation Five and Xbox Series X and S. || PLATFORMS :: PLAYSTATION 5 AND XBOX SERIES X|S :: The two platforms listed",
  "The story is set in Vice City, and across the wider state of Leonida. || SETTING :: VICE CITY AND LEONIDA :: Named on the official page",
  "The official description centers on Jason and Lucia, forced to rely on each other when an easy score goes wrong. || NAMED ON THE PAGE :: JASON AND LUCIA :: An easy score goes wrong",
  "Anything beyond that is not confirmed here. This is an independent fan guide, not affiliated with Rockstar Games. || EVERYTHING ELSE :: NOT CONFIRMED HERE :: Independent fan guide",
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("premium demo: sourced content to both formats, left pending review", async ({
  page,
  browser,
}) => {
  const made: string[] = [];
  await signIn(page, EDITOR);
  await page.goto("/studio/sources");
  if ((await page.getByText(SOURCE_TITLE).count()) === 0) {
    await page.getByLabel("Title").fill(SOURCE_TITLE);
    await page.getByLabel("Publisher / owner").fill(PUBLISHER);
    await page.getByLabel("URL (optional)").fill("https://www.rockstargames.com/VI");
    await page.getByLabel("Source class").selectOption("OFFICIAL_SOURCE");
    await page.getByLabel("Source type").fill("official game page");
    await page.getByLabel("Factual as-of date").fill("2026-11-16");
    await page
      .getByLabel("Support notes / excerpt")
      .fill(
        'Retrieved 2026-11-16. Words on the page: "November 19, 2026"; "PlayStation 5"; "Xbox Series X|S"; "Vice City"; "state of Leonida"; "Jason and Lucia"; "easy score goes wrong"; "rely on each other". One lineage: Rockstar\'s own site.',
      );
    await page.getByRole("button", { name: "Register source" }).click();
    await expect(page.getByText(SOURCE_TITLE).first()).toBeVisible();
    made.push("source");
  }
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
    }
  }
  await page.goto("/studio/content");
  const existing = page.getByRole("link", { name: TITLE });
  if ((await existing.count()) === 0) {
    await page.getByLabel("Working title").fill(TITLE);
    await page.getByRole("button", { name: "Create idea" }).click();
    made.push("content");
  } else await existing.first().click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0]!;

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

  for (const claim of CLAIMS) {
    await page.goto(`${contentUrl}?tab=evidence`);
    const cell = page.getByRole("cell", { name: new RegExp(esc(claim.slice(0, 50))) });
    if ((await cell.count()) === 0) {
      await page
        .getByLabel("Reviewed claim")
        .selectOption({ label: `[CONFIRMED] ${claim.slice(0, 60)}` });
      await page.getByRole("button", { name: "Link claim" }).click();
      await expect(cell).toBeVisible();
    }
  }
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
  if ((await card.getByText(/Voiceover: shorts\/voiceover\//).count()) === 0) {
    await card.getByRole("button", { name: /voiceover \(local-say-fixture\)/ }).click();
    await expect(card.getByText(/Voiceover: shorts\/voiceover\//)).toBeVisible({
      timeout: 180_000,
    });
    made.push("narration");
  }
  const panel = card.getByTestId("premium-panel");
  if ((await card.getByText(/· PREMIUM/).count()) === 0) {
    const start = panel.getByRole("button", { name: /(Start|Retry) premium render/ });
    if ((await start.count()) > 0) {
      await start.click();
      made.push("premium render");
    }
    await expect(panel.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 600_000 });
  }
  await expect(card.getByText(/· PREMIUM/)).toHaveCount(2);
  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(2);
  await expect(card.getByText("MIKE APPROVED")).toHaveCount(0);

  await page.goto("/studio/library");
  const items = page.getByTestId("library-item").filter({ hasText: TITLE });
  await expect(items).toHaveCount(2);
  await expect(items.getByRole("button", { name: "Approve internally" })).toHaveCount(0); // not the Owner
  await expect(page.getByRole("button", { name: /Publish/ })).toHaveCount(0);
  const out = [];
  for (const i of [0, 1]) {
    const item = items.nth(i);
    const video = item.locator("video");
    await video.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    const play = await video.evaluate(async (v: HTMLVideoElement) => {
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
          (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ??
          null,
      };
    });
    expect(play.playedSec).toBeGreaterThan(0.5);
    out.push({
      ...play,
      sha256: /[0-9a-f]{64}/.exec(await item.getByText(/^SHA-256:/).innerText())?.[0],
      qa: await item.locator("summary").filter({ hasText: "Automatic QA" }).innerText(),
    });
  }
  if (process.env.PRODUCTION_SUMMARY_PATH)
    await writeFile(
      process.env.PRODUCTION_SUMMARY_PATH,
      JSON.stringify({ createdThisRun: made, contentUrl, library: out }, null, 2),
    );
  console.log(`created this run: ${made.length ? made.join(", ") : "nothing"}`);
});
