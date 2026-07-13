import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { Actor } from "@/lib/auth/context";
import { Role } from "@prisma/client";
import { createSource, createClaim, reviewClaim, linkClaimToContent } from "@/domain/evidence";
import { createContent } from "@/domain/content";
import { saveScriptVersion } from "@/domain/script";
import { createAsset, reviewAsset } from "@/domain/rights";
import { createTitleVariant, createThumbnailVariant } from "@/domain/packaging";
import { createPackagingExperiment, concludePackagingExperiment } from "@/domain/experiments";
import {
  createContributor,
  createAssignment,
  submitAssignment,
  recordRelease,
} from "@/domain/contributors";
import { createShot, submitCapture, reviewCapture } from "@/domain/capture";
import {
  createVisualBrief,
  approveVisualPrompt,
  generateWithMock,
  reviewVisualAsset,
} from "@/domain/visuals";
import { grantApproval } from "@/domain/approval";
import { publishPublicArticle } from "@/domain/publication";
import { createCorrection } from "@/domain/correction";

const DEMO_PASSWORD = "demo-password-123";
const DISCLAIMER =
  "Leonida Field Guide is an independent fan publication and is not affiliated with, endorsed by, sponsored by, or operated by Rockstar Games or Take-Two Interactive.";

async function truncateAll() {
  // Row-level DELETE/UPDATE triggers do not fire on TRUNCATE, so this safely
  // resets even the append-only / immutable tables for a repeatable seed.
  const tables = [
    "AuditEvent",
    "VisualAsset",
    "VisualBrief",
    "CaptureSession",
    "Shot",
    "Assignment",
    "Contributor",
    "ContentStatusHistory",
    "AnalyticsSnapshot",
    "UpdateTask",
    "Correction",
    "PublicArticleRevision",
    "Publication",
    "Approval",
    "ThumbnailVariant",
    "TitleVariant",
    "RightsReview",
    "Asset",
    "AIGeneration",
    "ScriptVersion",
    "ContentBrief",
    "ContentClaim",
    "ContentRelation",
    "ClaimSource",
    "Claim",
    "Source",
    "ContentItem",
    "PromptTemplate",
    "Session",
    "RoleAssignment",
    "User",
    "Workspace",
  ];
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`,
  );
}

async function main() {
  await truncateAll();

  const workspace = await prisma.workspace.create({
    data: {
      name: "Leonida Field Guide",
      slug: "leonida-field-guide",
      disclaimer: DISCLAIMER,
      timezone: "America/New_York",
    },
  });

  async function makeUser(displayName: string, email: string, roles: Role[]): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        workspaceId: workspace.id,
        displayName,
        email,
        passwordHash: hashPassword(DEMO_PASSWORD),
        roles: { create: roles.map((role) => ({ workspaceId: workspace.id, role })) },
      },
    });
    return {
      userId: user.id,
      workspaceId: workspace.id,
      displayName,
      email,
      roles,
    };
  }

  // Three primary demo users (docs/01 Epic 1) plus role-coverage users.
  const owner = await makeUser("Mike (Owner)", "owner@leonida.test", [Role.OWNER]);
  const editor = await makeUser("Ed Editor", "editor@leonida.test", [Role.EDITOR]);
  const researcher = await makeUser("Rae Researcher", "researcher@leonida.test", [Role.RESEARCHER]);
  await makeUser("Will Writer", "writer@leonida.test", [Role.WRITER]);
  await makeUser("Pat Producer", "producer@leonida.test", [Role.PRODUCER]);
  await makeUser("Rin Rights", "rights@leonida.test", [Role.RIGHTS_REVIEWER]);
  await makeUser("Ana Analyst", "analyst@leonida.test", [Role.ANALYST]);
  await makeUser("Reed Only", "readonly@leonida.test", [Role.READ_ONLY]);
  const capUser = await makeUser("Cam Capture", "capture@leonida.test", [Role.CONTRIBUTOR]);
  await makeUser("Nia Narrator", "narrator@leonida.test", [Role.NARRATOR]);
  await makeUser("Vic VideoEditor", "videoeditor@leonida.test", [Role.VIDEO_EDITOR]);
  const designerUser = await makeUser("Dee Designer", "designer@leonida.test", [Role.DESIGNER]);
  void designerUser;

  // ---- Sources (official + reputable; no copyrighted media) ----
  const officialAnnounce = await createSource(researcher, {
    title: "Grand Theft Auto VI — official announcement",
    publisher: "Rockstar Games (official)",
    url: "https://www.rockstargames.com/",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "press release",
    supportNotes:
      "Official announcement stating Grand Theft Auto VI is in development and set in the state of Leonida.",
    factualAsOfDate: new Date("2026-06-01"),
  });
  const officialTrailer = await createSource(researcher, {
    title: "Grand Theft Auto VI — official trailer page",
    publisher: "Rockstar Games (official)",
    url: "https://www.rockstargames.com/VI",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "trailer page",
    supportNotes:
      "Official trailer page presents Leonida setting and lead characters Lucia and Jason (metadata only; no footage stored).",
    factualAsOfDate: new Date("2026-06-01"),
  });
  await createSource(researcher, {
    title: "Take-Two Interactive investor briefing (summary)",
    publisher: "Take-Two Interactive (official)",
    url: "https://www.take2games.com/ir",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "investor note",
    supportNotes: "Company reiterates GTA VI targeted release window.",
    factualAsOfDate: new Date("2026-05-15"),
  });

  // ---- Claims: one per classification (+ a blocked LEAKED example) ----
  const confirmed = await createClaim(researcher, {
    statement: "Grand Theft Auto VI is set in the state of Leonida.",
    classification: "CONFIRMED",
    publicWording: "GTA VI is set in the fictional state of Leonida.",
    sourceIds: [officialAnnounce.id, officialTrailer.id],
    confidence: 5,
  });
  const observed = await createClaim(researcher, {
    statement: "Official material shows two lead protagonists.",
    classification: "OBSERVED",
    publicWording: "Official material shows two lead protagonists.",
    sourceIds: [officialTrailer.id],
    confidence: 4,
  });
  const analysis = await createClaim(researcher, {
    statement: "The setting strongly evokes a modern reimagining of a Florida-like region.",
    classification: "ANALYSIS",
    publicWording: "Analysis: Leonida evokes a modern, Florida-like region.",
    sourceIds: [officialTrailer.id],
  });
  const prediction = await createClaim(researcher, {
    statement: "Assuming standard Rockstar cadence, a second trailer is likely before launch.",
    classification: "PREDICTION",
    publicWording:
      "Prediction: a second trailer is likely before launch (assumes typical cadence).",
    sourceIds: [],
  });
  const rumor = await createClaim(researcher, {
    statement: "An unnamed outlet claims a specific month for release.",
    classification: "RUMOR",
    publicWording: "Rumor (unverified, named outlet): a specific release month.",
    sourceIds: [],
  });
  const unverified = await createClaim(researcher, {
    statement: "A specific map size figure is circulating without adequate evidence.",
    classification: "UNVERIFIED",
    publicWording: "Unverified: a specific map-size figure lacks adequate evidence.",
    sourceIds: [],
  });
  // Blocked example: LEAKED is auto-quarantined and cannot advance.
  await createClaim(researcher, {
    statement: "[Quarantined] Alleged leaked build detail — must never be used.",
    classification: "LEAKED",
  });

  // Review the non-leaked claims (editor). CONFIRMED requires official source.
  for (const c of [confirmed, observed, analysis, prediction, rumor, unverified]) {
    await reviewClaim(editor, c.id);
  }

  // ---- Three 14-day pilot videos + three Shorts each ----
  const pilotTitles = [
    "Everything Rockstar Has Officially Confirmed About GTA VI in 15 Minutes",
    "GTA VI Standard vs Ultimate: What the Extra Money Actually Buys",
    "Can We Rebuild Leonida Using Official Evidence Only?",
  ];
  const pillars = ["BRIEFING", "FIELD_MANUAL", "EVIDENCE_BOARD"] as const;

  const pilots = [];
  for (let i = 0; i < pilotTitles.length; i++) {
    const parent = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: pillars[i]!,
      workingTitle: pilotTitles[i]!,
      viewerPromise: "Direct answers, graded by evidence, with zero leaks.",
      spoilerLevel: "NONE",
    });
    pilots.push(parent);
    for (let s = 1; s <= 3; s++) {
      await createContent(editor, {
        type: "SHORT",
        pillar: pillars[i]!,
        workingTitle: `${pilotTitles[i]!.slice(0, 40)} — Short ${s}`,
        viewerPromise: "One evidence-graded fact in under a minute.",
        spoilerLevel: "NONE",
      });
    }
  }

  // Give pilots due dates so the calendar shows overdue / this-week / later.
  const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  await prisma.contentItem.update({
    where: { id: pilots[0]!.id },
    data: { dueAt: daysFromNow(20) },
  });
  await prisma.contentItem.update({
    where: { id: pilots[1]!.id },
    data: { dueAt: daysFromNow(-3) },
  });
  await prisma.contentItem.update({
    where: { id: pilots[2]!.id },
    data: { dueAt: daysFromNow(4) },
  });

  // ---- Drive pilot #1 all the way to a PUBLISHED public guide ----
  const flagship = pilots[0]!;
  await linkClaimToContent(editor, flagship.id, confirmed.id, true);
  await linkClaimToContent(editor, flagship.id, observed.id);
  await linkClaimToContent(editor, flagship.id, analysis.id);

  await saveScriptVersion(editor, {
    contentId: flagship.id,
    body:
      "## Cold open\nHere is exactly what Rockstar has officially confirmed about GTA VI — and what it has not.\n\n" +
      "## Confirmed\nGTA VI is set in the fictional state of Leonida.\n\n" +
      "## What we only observe\nOfficial material shows two lead protagonists.\n\n" +
      "## Our read\nThe setting evokes a modern, Florida-like region — that part is analysis, not fact.",
  });

  const asset = await createAsset(editor, {
    contentId: flagship.id,
    name: "Original channel title card",
    mediaType: "image",
    ownership: "ORIGINAL",
    intendedUse: "Opening title card",
    licenseBasis: "Self-authored original graphic",
  });
  await reviewAsset(owner, { assetId: asset.id, riskLevel: "LOW", decision: "APPROVED" });

  const titleA = await createTitleVariant(editor, {
    contentId: flagship.id,
    text: "Everything Officially Confirmed About GTA VI (Evidence Only)",
    strategy: "SEARCH_FIRST",
    deceptionCheck: true,
  });
  const titleB = await createTitleVariant(editor, {
    contentId: flagship.id,
    text: "GTA VI: What's Actually Confirmed vs Everything Else",
    strategy: "BROWSE_FIRST",
    deceptionCheck: true,
  });

  // A concluded A/B title experiment (measured result separated from interpretation).
  const experiment = await createPackagingExperiment(editor, {
    contentId: flagship.id,
    hypothesis: "A browse-first framing raises CTR without overpromising.",
    variantAId: titleA.id,
    variantBId: titleB.id,
  });
  await concludePackagingExperiment(owner, {
    experimentId: experiment.id,
    result: "INCONCLUSIVE",
    conclusion: "Sample too small over the first 48h; re-run at launch with more impressions.",
  });

  await createThumbnailVariant(editor, {
    contentId: flagship.id,
    name: "Evidence board",
    brief:
      "Original evidence-board graphic with large legible text. No Rockstar marks, no trailer stills.",
    mobileCheck: true,
    deceptionCheck: true,
    trademarkCheck: true,
  });

  // Scoped approvals (rights + public website + editorial + script + packaging by Owner).
  await grantApproval(
    editor,
    flagship.id,
    "EDITORIAL_FACTS",
    "APPROVED",
    "Facts graded and sourced",
  );
  await grantApproval(editor, flagship.id, "SCRIPT", "APPROVED", "Script reviewed");
  await grantApproval(owner, flagship.id, "RIGHTS", "APPROVED", "Original assets only");
  await grantApproval(editor, flagship.id, "PACKAGING", "APPROVED", "Titles/thumbs non-deceptive");
  await grantApproval(owner, flagship.id, "PUBLIC_WEBSITE", "APPROVED", "Cleared for local site");

  await publishPublicArticle(owner, flagship.id);

  // One public correction on the published flagship (issues a new revision).
  await createCorrection(editor, {
    contentId: flagship.id,
    severity: "MINOR",
    originalText: "two lead protagonists",
    correctedText: "two lead protagonists shown in official material",
    reason:
      "Clarify that this is an observation from official material, not an explicit statement.",
    publicNotice: "Clarified that the two-protagonist detail is observed in official material.",
  });

  // One analytics snapshot (manual entry) on the flagship.
  await prisma.analyticsSnapshot.create({
    data: {
      contentId: flagship.id,
      platform: "youtube",
      snapshotAt: new Date(),
      impressions: 120000,
      views: 14000,
      ctr: 0.116,
      firstThirtySecondRetention: 0.62,
      averagePercentageViewed: 0.41,
      watchHours: 980,
      subscribersGained: 430,
      importedBy: owner.userId,
    },
  });

  // ---- Distributed production demo on pilot #2 ----
  const pilot2 = pilots[1]!;
  const camProfile = await createContributor(owner, {
    displayName: "Cam Capture",
    specialty: "Gameplay capture",
    userId: capUser.userId,
  });
  const capAssignment = await createAssignment(owner, {
    contentId: pilot2.id,
    contributorId: camProfile.id,
    kind: "GAMEPLAY_CAPTURE",
    deliverableNotes: "Capture edition-comparison shots at matched settings",
  });
  await createShot(editor, {
    contentId: pilot2.id,
    order: 1,
    title: "Edition menu comparison",
    description: "Side-by-side of Standard vs Ultimate contents screen",
  });
  const take1 = await submitCapture(capUser, {
    contentId: pilot2.id,
    assignmentId: capAssignment.id,
    platform: "PlayStation 5",
    gameVersion: "1.0",
    fileReference: "pilot2-take1.mp4",
    trialCount: 2,
  });
  await reviewCapture(editor, {
    captureId: take1.id,
    decision: "RETAKE_REQUESTED",
    reviewNotes: "Menu text illegible at 1080p; recapture at 4K.",
  });
  const take2 = await submitCapture(capUser, {
    contentId: pilot2.id,
    assignmentId: capAssignment.id,
    platform: "PlayStation 5",
    gameVersion: "1.0",
    fileReference: "pilot2-take2-4k.mp4",
    supersedesId: take1.id,
  });
  await reviewCapture(owner, { captureId: take2.id, decision: "APPROVED" });
  await submitAssignment(capUser, capAssignment.id, "4K retake delivered");
  await recordRelease(owner, capAssignment.id);

  const visualBrief = await createVisualBrief(editor, {
    contentId: pilot2.id,
    kind: "DIAGRAM",
    title: "Edition value diagram",
    prompt: "Original diagram comparing edition contents by evidence grade.",
    negativePrompt: "No GTA gameplay imitation, no Rockstar marks",
    costCeiling: 0,
  });
  await approveVisualPrompt(owner, visualBrief.id);
  const { asset: mockVisual } = await generateWithMock(editor, visualBrief.id);
  await reviewVisualAsset(owner, {
    assetId: mockVisual.id,
    decision: "APPROVED",
    disclosureDecision: "PRODUCTION_ASSISTANCE_ONLY",
    finalUsage: "Supporting diagram",
  });

  // ---- Blocked example on pilot #2: a leaked asset prevents publication ----
  const blockedAsset = await createAsset(editor, {
    contentId: pilots[1]!.id,
    name: "Alleged leaked footage clip (metadata only)",
    mediaType: "video",
    ownership: "THIRD_PARTY",
    ownerName: "Unknown",
    intendedUse: "DO NOT USE — demonstrates a hard block",
    flagLeaked: true,
  });
  await reviewAsset(owner, { assetId: blockedAsset.id, riskLevel: "BLOCKED", decision: "BLOCKED" });

  const counts = {
    users: await prisma.user.count(),
    content: await prisma.contentItem.count(),
    sources: await prisma.source.count(),
    claims: await prisma.claim.count(),
    publishedRevisions: await prisma.publicArticleRevision.count(),
    corrections: await prisma.correction.count(),
    audit: await prisma.auditEvent.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
