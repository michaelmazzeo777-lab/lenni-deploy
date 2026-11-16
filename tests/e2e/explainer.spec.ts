import { test, expect, type Page } from "@playwright/test";
import { rename } from "node:fs/promises";
import path from "node:path";

const OWNER = "owner@leonida.test";
const EDITOR = "editor@leonida.test";
const PASSWORD = "demo-password-123";
const U = `X${Date.now().toString().slice(-6)}`;
const TITLE = `${U} explainer e2e`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

const HOOK =
  "This is a test explainer. || TEST EXPLAINER :: WHAT THE PAGE SAYS :: Checked for this test";
const LINES = [
  "The first fact is shown on the test page. || FACT ONE :: THE FIRST FACT :: As shown on the page",
  "The second fact closes the video. || FACT TWO :: THE SECOND FACT :: Also shown on the page",
];

// The explainer workflow through the real Studio screens, on the real local
// pipeline: source -> reviewed claim -> content -> explainer session ->
// script with title cards -> narration -> a failed render, recorded and
// retried -> 16:9 draft (cycle 1) -> native 9:16 draft (cycle 2) -> QA
// evidence -> playback -> no duplicates -> Owner-only, version-bound approval
// -> still no way to publish.
test("explainer: two render cycles, failure and recovery, QA and review gate through the UI", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(420_000);
  await signIn(page, OWNER);

  // Source and a reviewed claim.
  await page.goto("/studio/sources");
  await page.getByLabel("Title").fill(`${U} Official Source`);
  await page.getByLabel("Publisher / owner").fill("Test Publisher");
  await page.getByLabel("Source class").selectOption("OFFICIAL_SOURCE");
  await page.getByLabel("Source type").fill("official page");
  await page.getByRole("button", { name: "Register source" }).click();
  await expect(page.getByText(`${U} Official Source`)).toBeVisible();

  await page.goto("/studio/claims");
  await page.getByLabel("Exact claim").fill(`${U} The page shows the first fact.`);
  await page.getByLabel("Classification").selectOption("CONFIRMED");
  await page
    .getByLabel("Supporting sources")
    .selectOption({ label: `Test Publisher: ${U} Official Source [OFFICIAL_SOURCE]` });
  await page.getByRole("button", { name: "Create claim" }).click();
  const claimRow = page.getByRole("row", { name: new RegExp(`${U} The page shows`) });
  await claimRow.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${U} The page shows`) })).toContainText(
    "REVIEWED",
  );

  // Content item and its explainer session.
  await page.goto("/studio/content");
  await page.getByLabel("Working title").fill(TITLE);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  await page.goto(`${contentUrl}?tab=production`);
  await page.getByRole("button", { name: /Start an explainer/ }).click();
  await expect(page.getByRole("row", { name: /None - original graphics/ })).toHaveCount(1);
  // Asking again does not create a second session.
  await page.getByRole("button", { name: /Start an explainer/ }).click();
  await expect(page.getByRole("row", { name: /None - original graphics/ })).toHaveCount(1);

  // Without a linked claim the script is refused.
  await page.goto("/studio/shorts");
  const row = page.getByRole("row", { name: new RegExp(TITLE) });
  await row.getByText("Write explainer script (title cards)").click();
  await row.getByLabel("Hook (with its card)").fill(HOOK);
  await row.getByLabel(/Explainer lines/).fill(LINES.join("\n"));
  await row.getByRole("button", { name: /Save explainer script/ }).click();
  await expect(page.locator("p.error").first()).toContainText("at least one linked claim");

  await page.goto(`${contentUrl}?tab=evidence`);
  await page
    .getByLabel("Reviewed claim")
    .selectOption({ label: `[CONFIRMED] ${U} The page shows the first fact.` });
  await page.getByRole("button", { name: "Link claim" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`${U} The page shows`) })).toBeVisible();

  // A line without its card is refused with an instruction; then the real script.
  await page.goto("/studio/shorts");
  await row.getByText("Write explainer script (title cards)").click();
  await row.getByLabel("Hook (with its card)").fill(HOOK);
  await row.getByLabel(/Explainer lines/).fill(`A line with no card.\n${LINES[1]}`);
  await row.getByRole("button", { name: /Save explainer script/ }).click();
  await expect(page.locator("p.error").first()).toContainText("Line 1 has no title card");

  await row.getByText("Write explainer script (title cards)").click();
  await row.getByLabel("Hook (with its card)").fill(HOOK);
  await row.getByLabel(/Explainer lines/).fill(LINES.join("\n"));
  await row.getByRole("button", { name: /Save explainer script/ }).click();
  await expect(row.getByText("Explainer scripted.")).toBeVisible();

  const card = page.locator(".card").filter({ hasText: TITLE }).filter({ hasText: "Hook:" });
  await expect(card.getByText("VALID")).toBeVisible();
  await card.getByRole("button", { name: /Synthesize voiceover \(local-say-fixture\)/ }).click();
  await expect(card.getByText(/Voiceover: shorts\/voiceover\//)).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/macOS system default voice \(synthetic\)/)).toBeVisible();

  // ---- Controlled failure: the narration file goes missing. ------------------
  const voText = await card.getByText(/Voiceover: shorts\/voiceover\//).innerText();
  const wav = path.resolve("./.data/storage", /shorts\/voiceover\/[a-z0-9]+\.wav/.exec(voText)![0]);
  await rename(wav, `${wav}.hidden`);
  await card.getByRole("button", { name: "Render 16:9 (local-ffmpeg)" }).click();
  await expect(card.getByText(/Render 16:9 failed \(attempt 2\)/)).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/failed after 2 attempts: Render failed/)).toBeVisible();
  await expect(card.locator("video")).toHaveCount(0); // nothing was recorded as a render

  // ---- Recovery, cycle 1: put it back and retry from the screen. -------------
  await rename(`${wav}.hidden`, wav);
  await card.getByRole("button", { name: "Retry render 16:9 (local-ffmpeg)" }).click();
  await expect(card.getByText("Render 1920x1080")).toBeVisible({ timeout: 120_000 });
  await expect(card.getByText(/Render 16:9 failed/)).toHaveCount(0);

  // ---- Cycle 2: the native vertical draft. -----------------------------------
  await card.getByRole("button", { name: "Render 9:16 (local-ffmpeg)" }).click();
  await expect(card.getByText("Render 1080x1920")).toBeVisible({ timeout: 120_000 });

  // No duplicates: both formats exist once, and neither can be rendered again.
  await expect(card.locator("video")).toHaveCount(2);
  await expect(card.getByRole("button", { name: /Render (9:16|16:9)/ })).toHaveCount(0);
  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(2);
  await expect(card.getByText("ILLUSTRATIVE DRAFT — not gameplay")).toHaveCount(2);
  await expect(card.getByText("FIXTURE — never publishable")).toHaveCount(0);
  await expect(card.getByText("Automatic QA: all checks passed")).toHaveCount(2);
  await expect(card.getByText(/PASS — Speech matches script: word error rate \d+%/)).toHaveCount(2);
  await expect(card.getByText(/PASS — Loudness: -1[5-7]\.\d LUFS/)).toHaveCount(2);
  await expect(card.getByText(/Still needs a person: .*Listen to the narration/)).toHaveCount(2);

  // Both masters decode in the browser at their native size, with audio data.
  const sizes: number[][] = [];
  for (const i of [0, 1]) {
    const video = card.locator("video").nth(i);
    await video.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    const info = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true; // autoplay policy; the audio is still decoded
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      v.pause();
      const decoded = (v as unknown as { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount;
      return [v.videoWidth, v.videoHeight, v.duration > 6, v.currentTime > 0.5, (decoded ?? 0) > 0];
    });
    expect(info.slice(2)).toEqual([true, true, true]);
    sizes.push(info.slice(0, 2) as number[]);
  }
  expect(sizes.sort((a, b) => a[0]! - b[0]!)).toEqual([
    [1080, 1920],
    [1920, 1080],
  ]);

  // QA evidence is retrievable: contact sheet, full report, bundle.
  const contact = await card
    .getByRole("link", { name: "contact sheet", exact: true })
    .first()
    .getAttribute("href");
  const sheet = await page.request.get(contact!);
  expect([sheet.status(), sheet.headers()["content-type"]]).toEqual([200, "image/jpeg"]);
  const reportHref = await card
    .getByRole("link", { name: "full report", exact: true })
    .first()
    .getAttribute("href");
  const report = await (await page.request.get(reportHref!)).json();
  expect(report.passed).toBe(true);
  expect(report.stateHistory.map((s: { state: string }) => s.state)).toEqual([
    "RENDERED",
    "QA_CHECKED",
    "PENDING_MIKE_REVIEW",
  ]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card
      .getByRole("link", { name: /Download review bundle/ })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leonida-short-.*\.zip$/);
  expect((await request.get(contact!, { maxRedirects: 0 })).status()).toBe(401);

  // ---- Review gate ------------------------------------------------------------
  // An Editor sees the drafts but has no approval control.
  const editorCtx = await browser.newContext();
  const editorPage = await editorCtx.newPage();
  await signIn(editorPage, EDITOR);
  await editorPage.goto("/studio/shorts");
  const editorCard = editorPage
    .locator(".card")
    .filter({ hasText: TITLE })
    .filter({ hasText: "Hook:" });
  await expect(editorCard.getByText("PENDING MIKE REVIEW")).toHaveCount(2);
  await expect(editorCard.getByRole("button", { name: "Approve this version" })).toHaveCount(0);
  await editorCtx.close();

  // The Owner must type the file's own hash: a wrong value approves nothing.
  const approve = card.getByRole("button", { name: "Approve this version" });
  const hashBox = card.getByLabel(/Owner approval of this exact file/);
  await expect(approve).toHaveCount(2);
  await hashBox.first().fill("00000000");
  await approve.first().click();
  await expect(page.locator("p.error").first()).toContainText("not this file's SHA-256");
  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(2);

  // With the right hash exactly that file is approved; the other stays pending.
  const shaText = await card
    .getByText(/^SHA-256:/)
    .first()
    .innerText();
  const sha = /[0-9a-f]{64}/.exec(shaText)![0];
  await hashBox.first().fill(sha.slice(0, 8));
  await approve.first().click();
  await expect(card.getByText("MIKE APPROVED")).toHaveCount(1);
  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(1);
  await expect(card.getByText(new RegExp(`Owner approved file ${sha.slice(0, 12)}`))).toBeVisible();

  // Approved or not, there is no publish control anywhere on these drafts.
  await expect(card.getByRole("button", { name: /Publish/ })).toHaveCount(0);
});
