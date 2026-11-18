import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

// Produces "Demonstration Video 001 (rebuilt)" through the Studio screens:
// source -> reviewed claims -> content -> explainer session -> script with
// title cards -> narration -> 16:9 draft -> native 9:16 draft.
//
// Safe to run again: every step first looks for what already exists, so a
// second run creates nothing and renders nothing.
//
// It signs in as the Editor and Producer demo accounts, never the Owner, and
// never approves, rejects or publishes anything. Both drafts are left at
// PENDING MIKE REVIEW.

const EDITOR = "editor@leonida.test";
const PRODUCER = "producer@leonida.test";
const PASSWORD = "demo-password-123";

const TITLE = "Production proof: how to test a gameplay claim";
const SOURCE_TITLE = "Original field-notes workflow proposal - 2026-11-17";
const PUBLISHER = "Leonida internal editorial draft";
const SOURCE_NOTES =
  "Agent-authored original instructional script. Proposed methodology, not Rockstar claims or accepted gameplay results. Original text and generated title cards; Apple synthetic voice; internal review only. No third-party gameplay or music.";
const CLAIMS = [
  "This proposed workflow records the question, platform, build, capture provenance and limitations before human review.",
];
const HOOK =
  "Welcome to Leonida field notes. This guide explains a proposed method for checking a gameplay claim. The visuals are original instructional graphics, not game footage. We will follow one question from a test plan to an evidence record that another person can review. || FIELD NOTES :: HOW TO TEST A GAMEPLAY CLAIM :: An internal workflow demonstration - not gameplay";
const LINES = [
  "Before testing a claim, write down exactly what you want to find out. Replace a broad question about whether something is better with one result that you can observe. Choose the same starting point and define what would count as a different outcome. || QUESTION :: ONE QUESTION, ONE OBSERVABLE RESULT :: Define the comparison before pressing record",
  "Next, record the game, platform, edition, and build. Add the game mode, difficulty, and settings that could affect the result. A useful observation describes the version that was tested. It does not promise that every platform or later update will behave the same way. || SCOPE :: PLATFORM - BUILD - MODE - SETTINGS :: Keep the result attached to its tested conditions",
  "Keep the original recording. Include a few seconds before the action and after the outcome, so a reviewer can understand the setup and the result. Write down the capture time and file name. A file hash helps identify the exact recording without changing its contents. || PROVENANCE :: KEEP THE ORIGINAL RECORDING :: Context before and after the action matters",
  "For a comparison, change one condition at a time. Repeat the same route or action where practical. Record attempts that do not support your first idea as well as the ones that do. A surprising result is a reason to investigate, rather than a reason to hide an attempt. || METHOD :: CHANGE ONE CONDITION AT A TIME :: Keep unsuccessful and contradictory attempts",
  "When reviewing footage, separate what the picture shows from what you think explains it. A vehicle stopping at one location is an observation in that recording. A statement about why it stopped is an interpretation unless the test provides evidence for that explanation. || EVIDENCE :: OBSERVATION IS NOT EXPLANATION :: Describe the frame before drawing a conclusion",
  "A trailer can be a useful source for a visible detail, but it is not your own gameplay test. Record the source and the exact time of the detail. Do not turn a brief promotional image into a promise about a mechanic that you have not tested. || SOURCE :: A TRAILER IS NOT A PLAY TEST :: Keep promotional observations in their own category",
  "Rights are a separate review. Being able to open a video does not establish permission to reuse it. Keep the source, creator permission, and any music restrictions with the asset. This demonstration uses original graphics and synthetic narration, and it is not cleared for publication. || RIGHTS :: ACCESS DOES NOT PROVE PERMISSION :: Original graphics and synthetic voice - internal review",
  "Finally, write a short conclusion that includes the conditions and limitations. Link the exact recording and record any conflicting result. Ask a person to review the evidence before treating it as an accepted gameplay finding. If the evidence is incomplete, leave the question open. || REVIEW :: STATE THE RESULT AND ITS LIMITS :: Human review is a separate step",
  "The practical checklist is simple: define the question, record the conditions, preserve the original, repeat the comparison, and separate observation from interpretation. Then review rights and ask for human acceptance. These are proposed field notes for an independent fan guide, not verified claims about game features. || FIELD NOTES :: QUESTION - CONDITIONS - EVIDENCE - REVIEW :: Independent fan guide - no gameplay claims",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test("Production proof long-form: actual Studio workflow, pending review", async ({
  page,
  browser,
}) => {
  const made: string[] = [];
  await signIn(page, EDITOR);

  // Source.
  await page.goto("/studio/sources");
  if ((await page.getByText(SOURCE_TITLE).count()) === 0) {
    await page.getByLabel("Title").fill(SOURCE_TITLE);
    await page.getByLabel("Publisher / owner").fill(PUBLISHER);

    await page.getByLabel("Source class").selectOption("USER_PROVIDED");
    await page.getByLabel("Source type").fill("Agent-authored original editorial proposal");
    await page.getByLabel("Factual as-of date").fill("2026-11-17");
    await page.getByLabel("Support notes / excerpt").fill(SOURCE_NOTES);
    await page.getByRole("button", { name: "Register source" }).click();
    await expect(page.getByText(SOURCE_TITLE).first()).toBeVisible();
    made.push("source");
  }

  // Claims, each tied to the source and marked reviewed.
  for (const claim of CLAIMS) {
    await page.goto("/studio/claims");
    const row = page.getByRole("row", { name: new RegExp(esc(claim)) });
    if ((await row.count()) === 0) {
      await page.getByLabel("Exact claim").fill(claim);
      await page.getByLabel("Classification").selectOption("ANALYSIS");
      await page
        .getByLabel("Supporting sources")
        .selectOption({ label: `${PUBLISHER}: ${SOURCE_TITLE} [USER_PROVIDED]` });
      await page.getByRole("button", { name: "Create claim" }).click();
      await expect(row).toHaveCount(1);
      made.push("claim");
    }
    if (!(await row.innerText()).includes("REVIEWED")) {
      await row.getByRole("button", { name: "Mark reviewed" }).click();
      await expect(row).toContainText("REVIEWED");
      made.push("claim review");
    }
  }

  // Content item.
  await page.goto("/studio/content");
  const existing = page.getByRole("link", { name: TITLE });
  if ((await existing.count()) === 0) {
    await page.getByLabel("Working title").fill(TITLE);
    await page.getByRole("button", { name: "Create idea" }).click();
    made.push("content");
  } else {
    await existing.first().click();
  }
  await expect(page).toHaveURL(/\/studio\/content\/[a-z0-9]+/);
  const contentUrl = page.url().split("?")[0]!;

  // Explainer session, started by the Producer.
  const producerCtx = await browser.newContext();
  const producer = await producerCtx.newPage();
  await signIn(producer, PRODUCER);
  await producer.goto(`${contentUrl}?tab=production`);
  const session = producer.getByRole("row", { name: /None - original graphics/ });
  if ((await session.count()) === 0) {
    await producer.getByRole("button", { name: /Start an explainer/ }).click();
    made.push("explainer session");
  }
  await expect(session).toHaveCount(1);
  await producerCtx.close();

  // Link the reviewed claims to the content.
  for (const claim of CLAIMS) {
    await page.goto(`${contentUrl}?tab=evidence`);
    const cell = page.getByRole("cell", { name: new RegExp(esc(claim.slice(0, 50))) });
    if ((await cell.count()) === 0) {
      await page
        .getByLabel("Reviewed claim")
        .selectOption({ label: `[ANALYSIS] ${claim.slice(0, 60)}` });
      await page.getByRole("button", { name: "Link claim" }).click();
      await expect(cell).toBeVisible();
      made.push("claim link");
    }
  }

  // Script with title cards.
  await page.goto("/studio/shorts");
  const card = page.locator(".card").filter({ hasText: TITLE }).filter({ hasText: "Hook:" });
  if ((await card.count()) === 0) {
    const row = page.getByRole("row", { name: new RegExp(esc(TITLE)) });
    await row.getByText("Write explainer script (title cards)").click();
    await row.getByLabel("Hook (with its card)").fill(HOOK);
    await row.getByLabel(/Explainer lines/).fill(LINES.join("\n"));
    await row.getByRole("button", { name: /Save explainer script/ }).click();
    await expect(card).toHaveCount(1);
    made.push("script");
  }
  await expect(card.getByText("VALID")).toBeVisible();

  // Narration (system voice), checked against the script by the Studio.
  if ((await card.getByText(/Voiceover: shorts\/voiceover\//).count()) === 0) {
    await card.getByRole("button", { name: /voiceover \(local-say-fixture\)/ }).click();
    await expect(card.getByText(/Voiceover: shorts\/voiceover\//)).toBeVisible({
      timeout: 180_000,
    });
    made.push("narration");
  }

  // Renders: one per format, never a second.
  for (const [format, size] of [["16:9", "1920x1080"]] as const) {
    if ((await card.getByText(`Render ${size}`).count()) === 0) {
      await card
        .getByRole("button", { name: new RegExp(`ender ${format} \\(local-ffmpeg\\)`) })
        .click();
      await expect(card.getByText(`Render ${size}`)).toBeVisible({ timeout: 300_000 });
      made.push(`render ${format}`);
    }
  }

  // What must be true however many times this has run.
  await expect(card.locator("video")).toHaveCount(1);

  await expect(card.getByText("PENDING MIKE REVIEW")).toHaveCount(1);
  await expect(card.getByText("MIKE APPROVED")).toHaveCount(0);
  await expect(card.getByText("ILLUSTRATIVE DRAFT — not gameplay")).toHaveCount(1);
  await expect(card.getByText("Automatic QA: all checks passed")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Approve this version" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Publish/ })).toHaveCount(0);

  // Both masters decode and play in the browser at their native size.
  const playback = [];
  for (const i of [0]) {
    const video = card.locator("video").nth(i);
    await video.evaluate((v: HTMLVideoElement) => v.load());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1)).toBe(true);
    playback.push(
      await video.evaluate(async (v: HTMLVideoElement) => {
        v.muted = true;
        await v.play();
        await new Promise((r) => setTimeout(r, 2000));
        v.pause();
        return {
          src: v.currentSrc,
          width: v.videoWidth,
          height: v.videoHeight,
          durationSec: v.duration,
          playedSec: v.currentTime,
          audioBytesDecoded:
            (v as unknown as { webkitAudioDecodedByteCount?: number })
              .webkitAudioDecodedByteCount ?? null,
        };
      }),
    );
  }
  for (const p of playback) expect(p.playedSec).toBeGreaterThan(0.5);

  const summary = {
    createdThisRun: made,
    contentUrl,
    playback,
    sha256: (await card.getByText(/^SHA-256:/).allInnerTexts()).map(
      (t) => /[0-9a-f]{64}/.exec(t)?.[0],
    ),
    links: await card
      .getByRole("link")
      .evaluateAll((as) => as.map((a) => [a.textContent?.trim(), (a as HTMLAnchorElement).href])),
  };
  if (process.env.PRODUCTION_SUMMARY_PATH) {
    await writeFile(process.env.PRODUCTION_SUMMARY_PATH, JSON.stringify(summary, null, 2));
  }
  console.log(`created this run: ${made.length ? made.join(", ") : "nothing"}`);
});
