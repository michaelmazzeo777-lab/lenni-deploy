import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
// CLIPS_TITLE runs the same workflow on a fresh content item and capture
// session, so a later cycle re-exercises ingest, selection and rendering
// instead of replaying the clips an earlier cycle already stored.
const title =
  process.env.CLIPS_TITLE ?? "Production proof supporting clips - original narrated graphics";

// The existing capability matrix splits this workflow across two roles:
// capture.submit is the Producer (submit the session, attach the ingest file),
// capture.review is the Editor (approve the session, the clipper panel, the
// library). Each role runs in its own browser context, so no sign-in inherits
// the other's session cookie. Never the Owner: every clip stays at
// PENDING MIKE REVIEW and nothing is approved here.
const EDITOR = "editor@leonida.test";
const PRODUCER = "producer@leonida.test";
const PASSWORD = "demo-password-123";

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("supporting clips: actual ingest, selection, rendering, pending review and replay", async ({
  page,
  browser,
}) => {
  test.setTimeout(900000);
  await signIn(page, EDITOR);
  await page.goto("/studio/helper?q=workflow+platform&scope=Internal+technical+proof");
  await expect(
    page.getByText(
      "This proposed workflow records the question, platform, build, capture provenance and limitations before human review.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto("/studio/content");
  const existing = page.getByRole("link", { name: title, exact: true });
  if (await existing.count()) await existing.click();
  else {
    await page.getByLabel("Working title").fill(title);
    await page.getByRole("button", { name: "Create idea" }).click();
  }
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];
  await page.goto(`${contentUrl}?tab=production`);
  const row = page.getByRole("row", { name: /Illustrative graphics/ });
  if (!(await row.count())) {
    // capture.submit: Producer only, in its own authenticated context.
    const producerCtx = await browser.newContext();
    const producer = await producerCtx.newPage();
    await signIn(producer, PRODUCER);
    await producer.goto(`${contentUrl}?tab=production`);
    await producer.getByText("Submit capture footage (metadata only)").click();
    await producer.getByLabel("Platform").fill("Illustrative graphics");
    await producer
      .getByLabel("Game version / patch")
      .fill("internal technical proof - not gameplay");
    await producer.getByRole("button", { name: "Submit capture" }).click();
    await expect(producer.getByRole("row", { name: /Illustrative graphics/ })).toHaveCount(1);
    await producerCtx.close();
    await page.goto(`${contentUrl}?tab=production`);
  }
  await expect(row).toHaveCount(1);
  // capture.review: the Editor's authorized review of the capture session.
  if (!(await row.innerText()).includes("Approved")) {
    await row.getByRole("button", { name: "Review", exact: true }).click();
    await expect(row).toContainText("Approved");
  }
  await page.goto("/studio/captures");
  const card = page.locator(".card").filter({ hasText: title });
  if (!(await card.getByText("SHA-256:").count())) {
    // Attaching the ingest file is capture.submit: Producer, separate context.
    const producerCtx = await browser.newContext();
    const producer = await producerCtx.newPage();
    await signIn(producer, PRODUCER);
    await producer.goto("/studio/captures");
    const producerCard = producer.locator(".card").filter({ hasText: title });
    await producerCard.getByText("Attach video from ingest folder").click();
    await producerCard.getByLabel("Video file").selectOption("production-proof-source.mp4");
    await producerCard.getByLabel("Capture method").selectOption("SYNTHETIC_FIXTURE");
    await producerCard.getByLabel("Rights status").selectOption("INTERNAL_FIXTURE");
    await producerCard.getByRole("button", { name: "Ingest & attach" }).click();
    await expect(producerCard.getByText("SHA-256:")).toBeVisible();
    await producerCtx.close();
    await page.goto("/studio/captures");
    await expect(card.getByText("SHA-256:")).toBeVisible();
  }
  const panel = card.getByTestId("clipper-panel");
  // CLIPPER_RETRY=1 re-runs the clipper on a session that already succeeded,
  // to re-render the same moments after a render-path change. The job is
  // idempotent per (file, clip count, crop mode), so a retry raises its
  // attempt counter rather than creating a second job.
  const retry = process.env.CLIPPER_RETRY === "1";
  if (retry || !(await panel.getByText("SUCCEEDED", { exact: true }).count())) {
    await panel.getByLabel("Clips", { exact: true }).fill("2");
    await panel.getByLabel("Crop mode").selectOption("blurred-fill");
    await panel.getByRole("button", { name: /Clip a session|Retry clip a session/ }).click();
    // On a retry the panel still shows the previous SUCCEEDED badge, so wait
    // for the job to actually pick up before waiting for it to finish.
    if (retry) {
      await expect(panel.getByText("RUNNING", { exact: true })).toBeVisible({ timeout: 60000 });
    }
    await expect(panel.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 600000 });
  }
  // Two moments x two formats is the ceiling, not a guarantee: the clipper
  // discards a render that fails clip QA (audited as clipper.clip_qa_failed)
  // and still succeeds, so the count comes from what the job actually stored.
  // Asserting the panel's own number against the Library catches a divergence
  // between the job record and the review surface.
  const finished = await panel
    .getByText(/Finished\. \d+ clip file\(s\) in the Library\./)
    .innerText();
  const stored = Number(/Finished\. (\d+) clip/.exec(finished)![1]);
  const attempts = Number(
    /attempt (\d+)/.exec(await panel.getByText(/attempt \d+/).innerText())![1],
  );
  expect(stored).toBeGreaterThan(0);
  // Two moments x two formats is the ceiling per attempt.
  expect(stored).toBeLessThanOrEqual(4 * attempts);
  await page.goto("/studio/library");
  const items = page.getByTestId("library-clip-item").filter({ hasText: title });
  await expect(items).toHaveCount(stored, { timeout: 30000 });
  const results = [];
  for (let i = 0; i < stored; i++) {
    const item = items.nth(i);
    await expect(item.getByText("PENDING MIKE REVIEW")).toBeVisible();
    await expect(item.getByText("PUBLICATION BLOCKED")).toBeVisible();
    const v = item.locator("video");
    await v.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => v.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    const playback = await v.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      v.pause();
      return {
        url: v.currentSrc,
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        played: v.currentTime,
      };
    });
    expect(playback.played).toBeGreaterThan(0.5);
    results.push({ ...playback, text: await item.innerText() });
  }
  // Every moment that produced a long-form master must also exist as a Short.
  // A caption that overflowed the vertical safe area used to drop the 9:16
  // render of a moment silently while the job still reported success.
  const formatsByRank = new Map<string, Set<string>>();
  for (const r of results) {
    const m = /moment (\d+) · (16:9|9:16)/.exec(r.text);
    if (!m) continue;
    const set = formatsByRank.get(m[1]!) ?? new Set<string>();
    set.add(m[2]!);
    formatsByRank.set(m[1]!, set);
  }
  expect(formatsByRank.size).toBeGreaterThan(0);
  for (const formats of formatsByRank.values()) {
    expect([...formats].sort()).toEqual(["16:9", "9:16"]);
  }
  await expect(page.getByRole("button", { name: /Publish/ })).toHaveCount(0);
  await page.reload();
  await expect(items).toHaveCount(stored);
  if (process.env.PRODUCTION_SUMMARY_PATH)
    await writeFile(
      process.env.PRODUCTION_SUMMARY_PATH,
      JSON.stringify({ contentUrl, requested: 2, formats: 2, stored, results }, null, 2),
    );
});
