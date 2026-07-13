import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("growth & administration surfaces", async ({ page }) => {
  await signIn(page);

  // Production board renders workflow columns.
  await page.goto("/studio/board");
  await expect(page.getByRole("heading", { name: "Production board" })).toBeVisible();

  // Analytics: import a snapshot for the default-selected content; a scorecard renders.
  await page.goto("/studio/analytics");
  await page.getByLabel("CTR (0–1, e.g. 0.08)").fill("0.09");
  await page.getByLabel("First-30s retention (0–1)").fill("0.72");
  await page.getByLabel("Average % viewed (0–1)").fill("0.5");
  await page.getByRole("button", { name: "Import snapshot" }).click();
  await expect(page.getByText("Click-through rate").first()).toBeVisible();

  // Roles: grant a seeded Writer the Analyst role (Owner only).
  await page.goto("/studio/admin/roles");
  const writerRow = page.getByRole("row", { name: /Will Writer/ });
  await writerRow.getByLabel("Add role for Will Writer").selectOption("ANALYST");
  await writerRow.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /Will Writer/ }).getByRole("button", { name: /ANALYST/ }),
  ).toBeVisible();

  // Update queue: flag a source stale; it appears in the stale list.
  await page.goto("/studio/updates");
  await page.getByLabel("Source").selectOption({ index: 0 });
  await page.getByLabel("Reason").fill("Superseded by newer official info");
  await page.getByRole("button", { name: "Mark stale" }).click();
  await expect(page.getByText("STALE").first()).toBeVisible();

  // Export: the CSV endpoint returns data with the expected header (uses the session cookie).
  const res = await page.request.get("/studio/export/claims?format=csv");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("classification");
});
