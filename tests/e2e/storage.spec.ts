import { test, expect } from "@playwright/test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("local file storage: upload, quarantine, scan", async ({ page }) => {
  await signIn(page, OWNER);

  // Create a fresh content item so it has no existing assets/files.
  await page.goto("/studio/content");
  const uniqueTitle = `Storage e2e ${Date.now()}`;
  await page.getByLabel("Working title").fill(uniqueTitle);
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  await page.goto(`${contentUrl}?tab=assets`);
  await page.getByLabel("Name").fill("E2E title card");
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page.getByRole("cell", { name: "E2E title card" })).toBeVisible();

  // Upload a real PNG >1 MiB via the file input. The size matters: it proves
  // the server-action bodySizeLimit override (next.config.ts) — with Next's
  // 1 MB default this upload dies in the framework before our validation.
  const dir = mkdtempSync(path.join(tmpdir(), "fgs-upload-"));
  const filePath = path.join(dir, "card.png");
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(filePath, Buffer.concat([pngSignature, Buffer.alloc(2 * 1024 * 1024, 7)]));
  const row = page.getByRole("row", { name: /E2E title card/ });
  await row.locator('input[type="file"]').setInputFiles(filePath);
  await row.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/tab=assets/);

  const fileCell = page
    .getByRole("row", { name: /E2E title card/ })
    .locator("td")
    .nth(2);
  await expect(fileCell.getByText("PENDING")).toBeVisible();
  await expect(fileCell.getByText("card.png")).toBeVisible();

  await fileCell.getByRole("button", { name: "Run mock scan" }).click();
  await expect(page).toHaveURL(/tab=assets/);
  await expect(
    page
      .getByRole("row", { name: /E2E title card/ })
      .locator("td")
      .nth(2)
      .getByText("CLEAN"),
  ).toBeVisible();
});
