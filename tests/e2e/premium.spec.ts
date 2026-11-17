import { test, expect, type Page } from "@playwright/test";

const OWNER = "owner@leonida.test";
const EDITOR = "editor@leonida.test";
const PASSWORD = "demo-password-123";
const U = `P${Date.now().toString().slice(-6)}`;
const TITLE = `${U} night market hours`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

const HOOK =
  "The night market on the old quay now opens four evenings every week. || NEW HOURS :: FOUR EVENINGS A WEEK :: On the old quay";
const LINES = [
  "Stalls open at six in the evening, and the last ones close at eleven. || OPENING TIMES :: SIX TO ELEVEN :: Evening hours",
  "Entry is free for everyone, and the car park beside the quay costs two coins. || GETTING IN :: FREE ENTRY :: Parking costs two coins",
];

// The whole operator path for a premium video, through the screens only:
// CREATE (sourced content) -> PRODUCE (background job: progress, cancel, retry)
// -> LIBRARY (play with sound and captions) -> REVIEW (evidence, rights, QA,
// internal approval, revision request). Nothing can be published.
test("premium: sourced content to two playable formats, with cancel, retry, library and review", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(600_000);
  await signIn(page, OWNER);

  // CREATE: a source, a reviewed claim, the content item, its explainer session.
  await page.goto("/studio/sources");
  await page.getByLabel("Title").fill(`${U} Market notice`);
  await page.getByLabel("Publisher / owner").fill("Quay Council");
  await page.getByLabel("Source class").selectOption("OFFICIAL_SOURCE");
  await page.getByLabel("Source type").fill("official notice");
  await page.getByRole("button", { name: "Register source" }).click();
  await expect(page.getByText(`${U} Market notice`)).toBeVisible();
  await page.goto("/studio/claims");
  await page.getByLabel("Exact claim").fill(`${U} The notice lists four market evenings.`);
  await page.getByLabel("Classification").selectOption("CONFIRMED");
  await page
    .getByLabel("Supporting sources")
    .selectOption({ label: `Quay Council: ${U} Market notice [OFFICIAL_SOURCE]` });
  await page.getByRole("button", { name: "Create claim" }).click();
  await page
    .getByRole("row", { name: new RegExp(`${U} The notice lists`) })
    .getByRole("button", { name: "Mark reviewed" })
    .click();
  await page.goto("/studio/content");
  await page.getByLabel("Working title").fill(TITLE);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];
  await page.goto(`${contentUrl}?tab=production`);
  await page.getByRole("button", { name: /Start an explainer/ }).click();
  await page.goto(`${contentUrl}?tab=evidence`);
  await page
    .getByLabel("Reviewed claim")
    .selectOption({ label: `[CONFIRMED] ${U} The notice lists four market evenings.` });
  await page.getByRole("button", { name: "Link claim" }).click();

  // Script and narration.
  await page.goto("/studio/shorts");
  const row = page.getByRole("row", { name: new RegExp(TITLE) });
  await row.getByText("Write explainer script (title cards)").click();
  await row.getByLabel("Hook (with its card)").fill(HOOK);
  await row.getByLabel(/Explainer lines/).fill(LINES.join("\n"));
  await row.getByRole("button", { name: /Save explainer script/ }).click();
  const card = page.locator(".card").filter({ hasText: TITLE }).filter({ hasText: "Hook:" });
  await card.getByRole("button", { name: /Synthesize voiceover/ }).click();
  await expect(card.getByText(/Voiceover: shorts\/voiceover\//)).toBeVisible({ timeout: 60_000 });

  // PRODUCE: start, watch real progress, cancel, see the canceled state persist, retry.
  const panel = card.getByTestId("premium-panel");
  await panel.getByRole("button", { name: "Start premium render" }).click();
  await expect(panel.getByText("RUNNING", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Rendering picture: 16:9 \d+%, 9:16 \d+%/)).toBeVisible({
    timeout: 90_000,
  }); // the page refreshes itself
  await panel.getByRole("button", { name: "Cancel premium render" }).click();
  await expect(panel.getByText("CANCELED", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("Canceled by the operator")).toBeVisible();
  await page.reload();
  await expect(panel.getByText("CANCELED", { exact: true })).toBeVisible(); // stored, not just shown
  await expect(card.locator("video")).toHaveCount(0);
  await panel.getByRole("button", { name: "Retry premium render" }).click();
  await expect(panel.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 300_000 });
  await expect(panel.getByText("attempt 2")).toBeVisible();
  await expect(card.getByText(/· PREMIUM/)).toHaveCount(2);
  await expect(panel.getByRole("button", { name: /premium render/ })).toHaveCount(0); // nothing to start twice

  // LIBRARY: both files are listed and really play, with sound.
  await page.getByRole("link", { name: "Library & review" }).click();
  const items = page.getByTestId("library-item").filter({ hasText: TITLE });
  await expect(items).toHaveCount(2);
  const sizes: number[][] = [];
  for (const i of [0, 1]) {
    const video = items.nth(i).locator("video");
    await video.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    const info = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      v.pause();
      const decoded = (v as unknown as { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount;
      return [
        v.videoWidth,
        v.videoHeight,
        v.duration > 10,
        v.currentTime > 0.5,
        (decoded ?? 0) > 0,
      ];
    });
    expect(info.slice(2)).toEqual([true, true, true]);
    sizes.push(info.slice(0, 2) as number[]);
  }
  expect(sizes.sort((a, b) => a[0]! - b[0]!)).toEqual([
    [1080, 1920],
    [1920, 1080],
  ]);
  // Captions: burned in (checked by QA below) and available as a file with this script's words.
  const srtHref = await items
    .first()
    .getByRole("link", { name: "Caption file (SRT)" })
    .getAttribute("href");
  const srt = await page.request.get(srtHref!);
  expect(srt.status()).toBe(200);
  expect(await srt.text()).toContain("The night market on the old quay");
  expect((await request.get(srtHref!, { maxRedirects: 0 })).status()).toBe(401); // not without signing in
  const videoSrc = await items.first().locator("video").getAttribute("src");
  expect((await request.get(videoSrc!, { maxRedirects: 0 })).status()).toBe(401);

  // REVIEW: evidence, asset rights, QA and state are on the page.
  const first = items.first();
  await expect(first.getByText(`${U} The notice lists four market evenings.`)).toBeVisible();
  await expect(first.getByText(/Quay Council: .* Market notice/)).toBeVisible();
  await expect(
    first.getByText(/background art: .* OPEN - provenance unproven/).first(),
  ).toBeVisible();
  await expect(first.locator("summary").filter({ hasText: "Automatic QA" })).toContainText(
    "all checks passed",
  );
  await expect(first.getByText(/PASS — burned captions follow the caption file/)).toBeVisible();
  await expect(first.getByText(/PASS — caption starts vs measured speech onset/)).toBeVisible();
  await expect(first.getByText(/Still needs a person: Listen to the narration/)).toBeVisible();
  await expect(first.getByText("PENDING MIKE REVIEW")).toBeVisible();
  await expect(first.getByText("PUBLICATION BLOCKED")).toBeVisible();

  // An Editor can ask for a revision but cannot approve.
  const editorCtx = await browser.newContext();
  const editorPage = await editorCtx.newPage();
  await signIn(editorPage, EDITOR);
  await editorPage.goto("/studio/library");
  const editorItems = editorPage.getByTestId("library-item").filter({ hasText: TITLE });
  await expect(editorItems.first().getByRole("button", { name: "Request revision" })).toBeVisible();
  await expect(editorItems.getByRole("button", { name: "Approve internally" })).toHaveCount(0);
  await editorCtx.close();

  // The Owner approves one exact file by its hash; a wrong hash approves nothing.
  await first.getByLabel(/Owner approval of this exact file/).fill("00000000");
  await first.getByRole("button", { name: "Approve internally" }).click();
  await expect(page.locator("p.error").first()).toContainText("not this file's SHA-256");
  await expect(page).toHaveURL(/\/studio\/library/);
  const sha = /[0-9a-f]{64}/.exec(
    await items
      .first()
      .getByText(/^SHA-256:/)
      .innerText(),
  )![0];
  await items
    .first()
    .getByLabel(/Owner approval of this exact file/)
    .fill(sha.slice(0, 8));
  await items.first().getByRole("button", { name: "Approve internally" }).click();
  await expect(items.first().getByText("MIKE APPROVED (internal)")).toBeVisible();

  // The other file is sent back for revision; it is then no longer served.
  const second = items.nth(1);
  await second.getByLabel("What needs to change").fill("Slow the opening down");
  await second.getByRole("button", { name: "Request revision" }).click();
  await expect(items.nth(1).getByText("REVISION REQUESTED", { exact: true })).toBeVisible();
  await expect(items.nth(1).getByText("Revision requested: Slow the opening down")).toBeVisible();
  await expect(items.nth(1).locator("video")).toHaveCount(0);

  // Approved or not, nothing here or in the pipeline can publish it.
  await expect(page.getByRole("button", { name: /Publish/ })).toHaveCount(0);
  await page.goto("/studio/shorts");
  await expect(card.getByRole("button", { name: /Publish/ })).toHaveCount(0);
});
