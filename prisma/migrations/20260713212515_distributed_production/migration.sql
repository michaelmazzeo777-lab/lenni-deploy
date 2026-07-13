-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('RESEARCH', 'WRITING', 'GAMEPLAY_CAPTURE', 'EXPERIMENT', 'NARRATION', 'EDITING', 'THUMBNAIL_DESIGN', 'MOTION_GRAPHICS', 'RIGHTS_REVIEW');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RECEIVED');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('SUBMITTED', 'RETAKE_REQUESTED', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VisualKind" AS ENUM ('THUMBNAIL', 'DIAGRAM', 'TIMELINE', 'EVIDENCE_CARD', 'MAP', 'CHANNEL_GRAPHIC', 'TRANSITION', 'ANIMATED_CHART', 'STORYBOARD', 'B_ROLL', 'WEBSITE_IMAGE', 'SHORTS_COVER');

-- CreateEnum
CREATE TYPE "VisualBriefStatus" AS ENUM ('DRAFT', 'PROMPT_APPROVED', 'EXPORTED');

-- CreateEnum
CREATE TYPE "RealismClass" AS ENUM ('ORIGINAL_GRAPHIC', 'STYLIZED', 'REALISTIC');

-- CreateEnum
CREATE TYPE "DisclosureDecision" AS ENUM ('NOT_APPLICABLE', 'PRODUCTION_ASSISTANCE_ONLY', 'DISCLOSE_SYNTHETIC', 'HUMAN_REVIEW_REQUIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VisualAssetStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'BLOCKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'CONTRIBUTOR';
ALTER TYPE "Role" ADD VALUE 'NARRATOR';
ALTER TYPE "Role" ADD VALUE 'VIDEO_EDITOR';
ALTER TYPE "Role" ADD VALUE 'DESIGNER';

-- CreateTable
CREATE TABLE "Contributor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "specialty" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" TIMESTAMP(3),
    "deliverableNotes" TEXT,
    "reviewNotes" TEXT,
    "rightsReleaseStatus" "ReleaseStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "captureNotes" TEXT,
    "spoilerLevel" "SpoilerLevel" NOT NULL DEFAULT 'NONE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "shotId" TEXT,
    "platform" TEXT NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "captureDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settings" TEXT,
    "testConditions" TEXT,
    "trialCount" INTEGER,
    "hudVisible" BOOLEAN NOT NULL DEFAULT true,
    "containsLicensedMusic" BOOLEAN NOT NULL DEFAULT false,
    "modsDeclared" BOOLEAN NOT NULL DEFAULT false,
    "modsNotes" TEXT,
    "spoilerLevel" "SpoilerLevel" NOT NULL DEFAULT 'NONE',
    "fileReference" TEXT,
    "flagLeaked" BOOLEAN NOT NULL DEFAULT false,
    "status" "CaptureStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewNotes" TEXT,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualBrief" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "VisualKind" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "styleNotes" TEXT,
    "costCeiling" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "VisualBriefStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualAsset" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "jobId" TEXT,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "presentedAsRealGameplay" BOOLEAN NOT NULL DEFAULT false,
    "realismClassification" "RealismClass" NOT NULL DEFAULT 'ORIGINAL_GRAPHIC',
    "disclosureDecision" "DisclosureDecision",
    "status" "VisualAssetStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "rightsReviewerId" TEXT,
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "finalUsage" TEXT,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contributor_userId_key" ON "Contributor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_contentId_order_key" ON "Shot"("contentId", "order");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualBrief" ADD CONSTRAINT "VisualBrief_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualAsset" ADD CONSTRAINT "VisualAsset_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "VisualBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Distributed-production containment constraints.
-- ============================================================================

-- AI-generated visuals can NEVER be presented as real gameplay (DB-level).
ALTER TABLE "VisualAsset"
  ADD CONSTRAINT visual_ai_not_real_gameplay
  CHECK (NOT ("aiGenerated" AND "presentedAsRealGameplay"));

-- An approved visual asset must carry a disclosure decision, and it cannot be BLOCKED.
ALTER TABLE "VisualAsset"
  ADD CONSTRAINT visual_approved_needs_disclosure
  CHECK (status <> 'APPROVED' OR ("disclosureDecision" IS NOT NULL AND "disclosureDecision" <> 'BLOCKED'));

-- Leaked-flagged capture footage is forced to BLOCKED status.
ALTER TABLE "CaptureSession"
  ADD CONSTRAINT capture_leaked_must_be_blocked
  CHECK (NOT "flagLeaked" OR status = 'BLOCKED');
