import { test, expect } from "@playwright/test";

const PASSWORD = "demo-password-123";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("distributed production surfaces (owner) + contributor isolation", async ({ page }) => {
  // Owner sees the seeded contributor pipeline.
  await signIn(page, "owner@leonida.test");

  await page.goto("/studio/contributors");
  await expect(page.getByRole("heading", { name: "Contributors & assignments" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cam Capture" }).first()).toBeVisible();
  await expect(page.getByText("received").first()).toBeVisible();

  // Content detail: production tab shows the retake chain; visuals tab shows the
  // approved mock asset; handoff downloads.
  await page.goto("/studio/content");
  await page
    .getByRole("link", { name: "GTA VI Standard vs Ultimate: What the Extra Money Actually Buys" })
    .click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  await page.goto(`${contentUrl}?tab=production`);
  await expect(page.getByText("Capture sessions (2)")).toBeVisible();
  await expect(page.getByText("Retake Requested")).toBeVisible();
  await expect(page.getByText("replaces earlier take")).toBeVisible();

  await page.goto(`${contentUrl}?tab=visuals`);
  await expect(page.getByText("Edition value diagram")).toBeVisible();
  await expect(page.getByText("mock/mock-visual-deterministic-1")).toBeVisible();

  const contentId = contentUrl!.split("/").pop();
  const md = await page.request.get(`/studio/handoff/${contentId}`);
  expect(md.status()).toBe(200);
  expect(await md.text()).toContain("# Production handoff");
  const json = await page.request.get(`/studio/handoff/${contentId}?format=json`);
  expect((await json.json()).approvedCaptures.length).toBeGreaterThan(0);

  // Sign out; the restricted contributor sees ONLY their own assignments and
  // cannot reach role administration.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "capture@leonida.test");
  await page.goto("/studio/contributors");
  await expect(page.getByText("You see only your own assignments.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cam Capture" }).first()).toBeVisible();
  await page.goto("/studio/admin/roles");
  await expect(page.getByText("Only an Owner can manage roles.")).toBeVisible();
});
