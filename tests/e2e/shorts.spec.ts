import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

// Full mock pipeline through the real UI: capture (shorts-flagged) → approve →
// draft script → voiceover → render → human review → mock publish. Everything
// runs on deterministic mocks — no external call, no cost, clearly-fake video id.
test("shorts pipeline: capture to mock publish through the UI", async ({ page }) => {
  await signIn(page, OWNER);

  // Create a content item to hang the capture on.
  await page.goto("/studio/content");
  const title = `Shorts e2e ${Date.now()}`;
  await page.getByLabel("Working title").fill(title);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  // Submit a capture flagged as a Shorts candidate.
  await page.goto(`${contentUrl}?tab=production`);
  await page.getByText("Submit capture footage (metadata only)").click();
  await page.getByLabel("Platform").fill("PlayStation 5");
  await page.getByLabel("Game version / patch").fill("1.0");
  await page.getByLabel("File reference").fill("e2e-shorts-clip.mp4");
  await page.getByText("Candidate for Shorts pipeline").click();
  await page.getByRole("button", { name: "Submit capture" }).click();
  await expect(page).toHaveURL(/tab=production/);

  // Approve the capture.
  await page.getByRole("button", { name: "Review" }).first().click();
  await expect(page).toHaveURL(/tab=production/);

  // Walk the pipeline on the Shorts page.
  await page.goto("/studio/shorts");
  const row = page.getByRole("row", { name: /e2e-shorts-clip\.mp4/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Draft script (mock)" }).click();
  await expect(page).toHaveURL(/\/studio\/shorts$/);

  const card = page
    .locator(".card")
    .filter({ hasText: title })
    .filter({ hasText: "Hook:" })
    .first();
  await expect(card.getByText("VALID")).toBeVisible();

  await card.getByRole("button", { name: "Synthesize voiceover (mock)" }).click();
  await expect(page).toHaveURL(/\/studio\/shorts$/);
  const card2 = page.locator(".card").filter({ hasText: "Voiceover:" }).first();
  await card2.getByRole("button", { name: "Render (mock)" }).click();
  await expect(page).toHaveURL(/\/studio\/shorts$/);

  // Human quality gate: approve the PENDING render.
  const card3 = page.locator(".card").filter({ hasText: "Render 1080x1920" }).first();
  await expect(card3.getByText("PENDING")).toBeVisible();
  await card3.getByRole("button", { name: "Record decision" }).click();
  await expect(page).toHaveURL(/\/studio\/shorts$/);

  // Publish (mock): requires title/description; results in a clearly-fake id.
  const card4 = page.locator(".card").filter({ hasText: "Render 1080x1920" }).first();
  await card4.getByLabel("Title").fill("One detail everyone missed");
  await card4.getByLabel("Description").fill("Verified breakdown. Independent fan content.");
  await card4.getByRole("button", { name: "Publish (mock — no real upload)" }).click();
  await expect(page).toHaveURL(/\/studio\/shorts$/);

  const published = page.locator(".card").filter({ hasText: "PUBLISHED" }).first();
  await expect(published.getByText(/video id: mock-/)).toBeVisible();
});
