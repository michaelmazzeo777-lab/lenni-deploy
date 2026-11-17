import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

// Creators & rights and Platform connections, through the screens: a prospect
// is recorded and qualified, a draft agreement created (never sent), and the
// platform screen states truthfully that nothing is connected.
test("creators, agreement draft and platform connection status", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);

  await page.getByRole("link", { name: "Creators & rights" }).click();
  await expect(page.getByRole("heading", { name: /Creators & footage rights/ })).toBeVisible();
  const name = `E2E Creator ${Date.now()}`;
  await page.getByText("Record a prospect from public research").click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Public profile URL (https)")
    .fill(`https://www.youtube.com/@e2e-${Date.now()}`);
  await page.getByLabel("Research source URL").fill("https://www.youtube.com/");
  await page.getByRole("button", { name: "Record prospect" }).click();
  await expect(page.getByText(/Nobody has been contacted/)).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByLabel("Why they qualify").fill("Original commentary over their own captures.");
  await row.getByRole("button", { name: "Mark qualified" }).click();
  const qualified = page.getByRole("row").filter({ hasText: name });
  await expect(qualified.getByText("QUALIFIED")).toBeVisible();
  await qualified.getByText("Draft an agreement").click();
  await qualified.getByRole("button", { name: "Create draft (not sent)" }).click();
  await expect(page.getByText(/has not been sent to anyone/)).toBeVisible();
  const agreements = page.getByTestId("agreements");
  await expect(agreements.getByText(`Footage licence - ${name}`)).toBeVisible();
  await expect(agreements.getByText("Draft (not sent)").first()).toBeVisible();

  await page.getByRole("link", { name: "Platform connections" }).click();
  await expect(page.getByText("No account is connected.")).toBeVisible();
  for (const p of ["youtube", "twitch", "instagram", "facebook", "tiktok"]) {
    await expect(page.getByTestId(`platform-${p}`).getByText("NOT CONNECTED")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /connect/i })).toHaveCount(0);
  await expect(page.getByTestId("manual-publishing")).toBeVisible();
});
