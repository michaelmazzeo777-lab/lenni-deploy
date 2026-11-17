import { test, expect } from "@playwright/test";
import { transcriberConfig } from "@/lib/media/transcribe";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

// The long-session clipper through the UI, on the 10-minute planted-event
// fixture global-setup generates: ingest -> approve -> clip a session
// (background job: real progress, cancel, retry) -> Library review and
// owner approval. Skips cleanly (never a false pass) if this environment has
// no speech model configured - the clipper refuses to start without one.
test("clip a session: capture to clips with cancel, retry, library and review", async ({
  page,
}) => {
  test.setTimeout(900_000);
  test.skip(
    "missing" in transcriberConfig(),
    "No WHISPER_MODEL_PATH configured in this environment",
  );

  await page.goto("/signin");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);

  await page.goto("/studio/content");
  const title = `Clipper e2e ${Date.now()}`;
  await page.getByLabel("Working title").fill(title);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  await page.goto(`${contentUrl}?tab=production`);
  await page.getByText("Submit capture footage (metadata only)").click();
  await page.getByLabel("Platform").fill("PlayStation 5");
  await page.getByLabel("Game version / patch").fill("fixture");
  await page.getByRole("button", { name: "Submit capture" }).click();
  await page.getByRole("button", { name: "Review" }).first().click();
  await expect(page.getByRole("row", { name: /PlayStation 5 · fixture/ })).toContainText(
    "Approved",
  );

  // Ingest the 10-minute planted-event session.
  await page.goto("/studio/captures");
  const card = page.locator(".card").filter({ hasText: title });
  await card.getByText("Attach video from ingest folder").click();
  await card.getByLabel("Video file").selectOption("e2e_session.mp4");
  await card.getByLabel("Capture method").selectOption("SYNTHETIC_FIXTURE");
  await card.getByLabel("Rights status").selectOption("INTERNAL_FIXTURE");
  await card.getByRole("button", { name: "Ingest & attach" }).click();
  await expect(card.getByText("SHA-256:")).toBeVisible();

  // Clip a session: start, watch real progress, cancel, see it persist, retry.
  const panel = card.getByTestId("clipper-panel");
  await panel.getByLabel("Clips").fill("1");
  await panel.getByRole("button", { name: "Clip a session" }).click();
  await expect(panel.getByText("RUNNING", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Scanning|Transcribing|Rendering/)).toBeVisible({ timeout: 60_000 });
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText(/CANCELED|SUCCEEDED/)).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(panel.getByText(/CANCELED|SUCCEEDED/)).toBeVisible(); // stored, not just shown

  // The form resets to its default on reload; keep the request small.
  await panel.getByLabel("Clips").fill("1");
  await panel.getByRole("button", { name: /Clip a session|Retry clip a session/ }).click();
  await expect(panel.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 600_000 });

  // Library: at least one moment, both formats, playable, with evidence and QA.
  await page.getByRole("link", { name: "Library & review" }).click();
  await expect(page.getByRole("heading", { name: "Session clips" })).toBeVisible();
  const items = page.getByTestId("library-clip-item").filter({ hasText: title });
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count % 2).toBe(0);
  const formats = await items.allInnerTexts();
  expect(formats.some((t) => t.includes("16:9"))).toBe(true);
  expect(formats.some((t) => t.includes("9:16"))).toBe(true);

  const first = items.first();
  const video = first.locator("video");
  await video.evaluate((v: HTMLVideoElement) => v.load());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
  await expect(first.locator("summary").filter({ hasText: "Moment evidence" })).toBeVisible();
  await expect(first.locator("summary").filter({ hasText: "Automatic QA" })).toContainText(
    "all checks passed",
  );
  await expect(first.getByText("PENDING MIKE REVIEW")).toBeVisible();
  await expect(first.getByText("PUBLICATION BLOCKED")).toBeVisible();
  await expect(first.getByText(/RIGHTS OPEN/)).toBeVisible();

  // The Owner approves one exact file by its hash.
  const sha = /[0-9a-f]{64}/.exec(await first.getByText(/^SHA-256:/).innerText())![0];
  await first.getByLabel(/Owner approval of this exact file/).fill(sha.slice(0, 8));
  await first.getByRole("button", { name: "Approve internally" }).click();
  await expect(items.first().getByText("MIKE APPROVED (internal)")).toBeVisible();

  // Approved or not, nothing here can publish it.
  await expect(page.getByRole("button", { name: /Publish/ })).toHaveCount(0);
});
