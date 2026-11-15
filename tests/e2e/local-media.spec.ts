import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

// The real local pipeline through the UI on a synthetic fixture: ingest →
// analyze → approve a cut → operator script → narration → real MP4 render →
// playable in the page, downloadable bundle, and never publishable.
test("local pipeline: ingest to playable render through the UI", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto("/signin");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);

  await page.goto("/studio/content");
  const title = `Local media e2e ${Date.now()}`;
  await page.getByLabel("Working title").fill(title);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  await page.goto(`${contentUrl}?tab=production`);
  await page.getByText("Submit capture footage (metadata only)").click();
  await page.getByLabel("Platform").fill("PlayStation 5");
  await page.getByLabel("Game version / patch").fill("fixture");
  await page.getByText("Candidate for Shorts pipeline").click();
  await page.getByRole("button", { name: "Submit capture" }).click();
  await page.getByRole("button", { name: "Review" }).first().click();
  await expect(page.getByRole("row", { name: /PlayStation 5 · fixture/ })).toContainText(
    "Approved",
  );

  // Ingest the fixture with provenance.
  await page.goto("/studio/captures");
  const card = page.locator(".card").filter({ hasText: title });
  await card.getByText("Attach video from ingest folder").click();
  await card.getByLabel("Video file").selectOption("e2e_fixture.mp4");
  await card.getByLabel("Capture method").selectOption("SYNTHETIC_FIXTURE");
  await card.getByLabel("Rights status").selectOption("INTERNAL_FIXTURE");
  await card.getByRole("button", { name: "Ingest & attach" }).click();
  await expect(card.getByText("SHA-256:")).toBeVisible();
  await expect(card.getByText("FIXTURE — not gameplay")).toBeVisible();

  // Analyze, then approve the top-ranked cut.
  await card.getByRole("button", { name: "Analyze highlights" }).click();
  await expect(card.getByRole("button", { name: "Save cut 1" })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/motion/).first()).toBeVisible();
  await card.getByRole("button", { name: "Save cut 1" }).click();
  await expect(card.getByRole("row").filter({ hasText: "Save cut 1" })).toContainText("Approved");

  // Operator script → fixture narration → real renders.
  await page.goto("/studio/shorts");
  const row = page.getByRole("row", { name: new RegExp(title) });
  await row.getByText(/Write script for cut 1/).click();
  await row.getByLabel("Hook").fill("Internal technical fixture.");
  await row
    .getByLabel("Script lines (one per line)")
    .fill("Synthetic test footage.\nNot gameplay.");
  await row.getByRole("button", { name: "Save script (local-operator)" }).click();

  const script = page.locator(".card").filter({ hasText: title }).filter({ hasText: "Hook:" });
  await expect(script.getByText("VALID")).toBeVisible();
  await script.getByRole("button", { name: "Synthesize voiceover (local-say-fixture)" }).click();
  await expect(script.getByText("Voiceover:")).toBeVisible({ timeout: 30_000 });
  await script.getByRole("button", { name: "Render 9:16 (local-ffmpeg)" }).click();
  await expect(script.getByText("Render 1080x1920")).toBeVisible({ timeout: 90_000 });
  await expect(script.getByText("FIXTURE — never publishable")).toBeVisible();

  // The master really plays: the browser decodes it to a real duration/size.
  const video = script.locator("video").first();
  await video.evaluate((v: HTMLVideoElement) => v.load());
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight, v.duration > 3]),
    )
    .toEqual([1080, 1920, true]);

  // Bundle downloads as a zip.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    script.getByRole("link", { name: /Download review bundle/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leonida-short-.*\.zip$/);

  // Human approval still leaves a fixture unpublishable (no publish form).
  await script.getByRole("button", { name: "Record decision" }).click();
  await expect(script.getByText("CLEAN")).toBeVisible();
  await expect(script.getByRole("button", { name: /Publish/ })).toHaveCount(0);

  // Anonymous access to stored media is refused.
  const src = await video.getAttribute("src");
  const anon = await request.get(src!, { maxRedirects: 0 });
  expect([401, 403, 302, 307]).toContain(anon.status());
});
