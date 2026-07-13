import { test, expect } from "@playwright/test";

const OWNER = "owner@leonida.test";
const PASSWORD = "demo-password-123";
// Kept short so it fits within the studio's truncated <option> labels (<=40 chars).
const UNIQUE = `E2E${Date.now().toString().slice(-6)}`;

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("anonymous users cannot enter the studio", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/signin/);
});

test("primary editorial-to-publication workflow", async ({ page }) => {
  // 1. Sign in (Owner has full capability for the happy path).
  await signIn(page, OWNER);

  // 2. Register a source.
  await page.goto("/studio/sources");
  await page.getByLabel("Title").fill(`${UNIQUE} Official Source`);
  await page.getByLabel("Publisher / owner").fill("Rockstar Games (official)");
  await page.getByLabel("Source class").selectOption("OFFICIAL_SOURCE");
  await page.getByLabel("Source type").fill("press release");
  await page.getByLabel("Support notes / excerpt").fill("Official: GTA VI is set in Leonida.");
  await page.getByRole("button", { name: "Register source" }).click();
  await expect(page.getByText(`${UNIQUE} Official Source`)).toBeVisible();

  // 3. Create a CONFIRMED claim citing that source, then review it.
  await page.goto("/studio/claims");
  await page.getByLabel("Exact claim").fill(`${UNIQUE} GTA VI is set in Leonida.`);
  await page.getByLabel("Classification").selectOption("CONFIRMED");
  await page.getByLabel("Public wording").fill("GTA VI is set in Leonida.");
  await page.getByLabel("Supporting sources").selectOption({
    label: `Rockstar Games (official): ${UNIQUE} Official Source [OFFICIAL_SOURCE]`,
  });
  await page.getByRole("button", { name: "Create claim" }).click();
  const claimRow = page.getByRole("row", {
    name: new RegExp(`${UNIQUE} GTA VI is set in Leonida`),
  });
  await expect(claimRow).toBeVisible();
  await claimRow.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(`${UNIQUE} GTA VI is set in Leonida`) }),
  ).toContainText("REVIEWED");

  // 4. Create a content item.
  await page.goto("/studio/content");
  await page.getByLabel("Working title").fill(`${UNIQUE} Pilot`);
  await page.getByLabel("Type").selectOption("LONG_VIDEO");
  await page.getByLabel("Pillar").selectOption("BRIEFING");
  await page.getByLabel("Viewer promise").fill("Direct answers, evidence only.");
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0];

  // 5. Link the reviewed claim (Evidence tab).
  await page.goto(`${contentUrl}?tab=evidence`);
  await page
    .getByLabel("Reviewed claim")
    .selectOption({ label: `[CONFIRMED] ${UNIQUE} GTA VI is set in Leonida.` });
  await page.getByRole("button", { name: "Link claim" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`${UNIQUE} GTA VI`) })).toBeVisible();

  // 6. Generate an AI content packet (mock provider) and review it.
  await page.goto(`${contentUrl}?tab=ai`);
  await page
    .getByLabel("Sources")
    .selectOption({ label: `Rockstar Games (official): ${UNIQUE} Official Source` });
  await page
    .getByLabel("Claims (linked, non-leaked)")
    .selectOption({ label: `[CONFIRMED] ${UNIQUE} GTA VI is set in Leonida.` });
  await page.getByRole("button", { name: "Generate (mock)" }).click();
  await expect(page.getByText("VALID").first()).toBeVisible();
  await page.getByRole("button", { name: "Record review" }).click();

  // 7. Save a script version.
  await page.goto(`${contentUrl}?tab=script`);
  await page
    .getByLabel(/Script body/)
    .fill("## Intro\nGTA VI is set in Leonida — here is the official evidence.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText(/v1 —/)).toBeVisible();

  // 8. Add a rights-reviewed placeholder asset.
  await page.goto(`${contentUrl}?tab=assets`);
  await page.getByLabel("Name").fill("Original title card");
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page.getByRole("cell", { name: "Original title card" })).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("No rights blockers.")).toBeVisible();

  // 9. Add packaging: title + thumbnail.
  await page.goto(`${contentUrl}?tab=packaging`);
  await page.getByLabel("Title text").fill("Everything Confirmed About GTA VI (Evidence Only)");
  await page.getByRole("button", { name: "Add title" }).click();
  await expect(page.getByText("Title variants (1)")).toBeVisible();
  await page.getByLabel("Name").fill("Evidence board");
  await page.getByLabel(/Brief/).fill("Original evidence-board graphic. No Rockstar marks.");
  await page.getByRole("button", { name: "Add thumbnail brief" }).click();
  await expect(page.getByText("Thumbnail briefs (1)")).toBeVisible();

  // 10. Grant all five required approvals (Owner).
  for (const scope of ["EDITORIAL_FACTS", "SCRIPT", "RIGHTS", "PACKAGING", "PUBLIC_WEBSITE"]) {
    await page.goto(`${contentUrl}?tab=approvals`);
    await page.getByLabel("Scope").selectOption(scope);
    await page.getByRole("button", { name: "Record approval" }).click();
    await expect(page).toHaveURL(/tab=approvals/);
  }
  await expect(page.getByText("live").first()).toBeVisible();

  // 11. Publish to the public website.
  await page.goto(`${contentUrl}?tab=publication`);
  await expect(page.getByText("All READY preconditions satisfied.")).toBeVisible();
  await page.getByRole("button", { name: "Publish public article" }).click();
  await expect(page.getByText(/Published to the public site/)).toBeVisible();

  // 12. View the public guide.
  await page.goto("/guides");
  const link = page.getByRole("link", { name: new RegExp(`${UNIQUE} Pilot`) });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name: new RegExp(`${UNIQUE} Pilot`) })).toBeVisible();
  await expect(page.getByText(/independent fan publication/i).first()).toBeVisible();
  await expect(page.getByText("Classification key:")).toBeVisible();

  // 13. Record a correction; a new public revision shows it.
  await page.goto(`${contentUrl}?tab=corrections`);
  await page.getByLabel("Severity").selectOption("MINOR");
  await page.getByLabel("Original text").fill("set in Leonida");
  await page.getByLabel("Corrected text").fill("set in the state of Leonida");
  await page.getByLabel("Reason").fill("precision");
  await page.getByLabel("Public notice").fill("Clarified the state name.");
  await page.getByRole("button", { name: "Record correction" }).click();
  await expect(page.getByText("Clarified the state name.")).toBeVisible();

  // 14. Audit timeline contains the consequential events.
  await page.goto(`${contentUrl}?tab=audit`);
  for (const action of [
    "content.claim_linked",
    "script.version_saved",
    "approval.granted",
    "publication.published",
    "correction.recorded",
  ]) {
    await expect(page.getByText(action, { exact: false }).first()).toBeVisible();
  }
});
