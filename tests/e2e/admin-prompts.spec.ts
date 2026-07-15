import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const EDITOR = "editor@leonida.test";
const PASSWORD = "demo-password-123";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("prompt-template admin: owner versions a template; editor is refused", async ({ page }) => {
  await signIn(page, OWNER);

  await page.goto("/studio/admin/prompts");
  // Seeded v1 exists and is in use.
  await expect(page.getByRole("cell", { name: "v1", exact: true })).toBeVisible();
  await expect(page.getByText("ACTIVE (in use)")).toBeVisible();

  // Create version 2 through the form.
  await page
    .getByLabel("Editorial guidance (appended to the fixed safety rules)")
    .fill("E2E: open with the direct answer, then evidence in classification order.");
  await page.getByRole("button", { name: "Create version" }).click();
  await expect(page).toHaveURL(/\/studio\/admin\/prompts$/);
  await expect(page.getByRole("cell", { name: "v2", exact: true })).toBeVisible();

  // v2 is now the one in use; exactly one row is marked "in use".
  const inUseRow = page.getByRole("row", { name: /ACTIVE \(in use\)/ });
  await expect(inUseRow).toHaveCount(1);
  await expect(inUseRow.getByRole("cell", { name: "v2", exact: true })).toBeVisible();

  // Deactivate v2 → v1 becomes the one in use again (rollback path).
  await inUseRow.getByRole("button", { name: "Deactivate" }).click();
  await expect(
    page.getByRole("row", { name: /ACTIVE \(in use\)/ }).getByRole("cell", {
      name: "v1",
      exact: true,
    }),
  ).toBeVisible();

  // An editor gets the refusal message, not the form.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, EDITOR);
  await page.goto("/studio/admin/prompts");
  await expect(page.getByText("Only an Owner can manage prompt templates.")).toBeVisible();
});
