-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'RESEARCHER', 'WRITER', 'PRODUCER', 'RIGHTS_REVIEWER', 'ANALYST', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('LONG_VIDEO', 'SHORT', 'WEBSITE_GUIDE', 'NEWS_BRIEFING', 'EVIDENCE_ANALYSIS', 'EXPERIMENT', 'DOCUMENTARY', 'COMMUNITY_POST', 'NEWSLETTER_ISSUE');

-- CreateEnum
CREATE TYPE "Pillar" AS ENUM ('BRIEFING', 'EVIDENCE_BOARD', 'FIELD_MANUAL', 'FIELD_LAB', 'LEONIDA_STORIES');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'TRIAGE', 'RESEARCH', 'EVIDENCE_READY', 'OUTLINE', 'SCRIPT_DRAFT', 'SCRIPT_REVIEW', 'PRODUCTION', 'EDIT_REVIEW', 'PACKAGING', 'RIGHTS_REVIEW', 'APPROVAL', 'READY', 'PUBLISHED', 'UPDATE_DUE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SpoilerLevel" AS ENUM ('NONE', 'PREMISE_ONLY', 'EARLY_GAME', 'MIDGAME', 'MAJOR_STORY', 'ENDING');

-- CreateEnum
CREATE TYPE "SourceClass" AS ENUM ('OFFICIAL_SOURCE', 'WEB_CORROBORATED', 'USER_PROVIDED', 'UNVERIFIED', 'STALE_RISK', 'CONFLICT');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('ACTIVE', 'STALE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ClaimClassification" AS ENUM ('CONFIRMED', 'OBSERVED', 'ANALYSIS', 'PREDICTION', 'RUMOR', 'UNVERIFIED', 'LEAKED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PROPOSED', 'REVIEWED', 'QUARANTINED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetOwnership" AS ENUM ('ORIGINAL', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'REVIEWED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RightsRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RightsDecision" AS ENUM ('APPROVED', 'NEEDS_WORK', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalScope" AS ENUM ('EDITORIAL_FACTS', 'SCRIPT', 'RIGHTS', 'PACKAGING', 'PUBLIC_WEBSITE', 'YOUTUBE', 'SPONSOR', 'AFFILIATE', 'NEWSLETTER', 'MERCHANDISE');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublicationChannel" AS ENUM ('PUBLIC_WEBSITE', 'YOUTUBE', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "CorrectionSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('REPORTED', 'IN_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "UpdateTaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "AITaskType" AS ENUM ('RESEARCH_PLAN', 'SOURCE_SUMMARY', 'CLAIM_EXTRACTION', 'CONTENT_PACKET', 'SHORTS', 'WEBSITE_GUIDE', 'PACKAGING', 'ANALYTICS', 'CORRECTION_SUGGESTION');

-- CreateEnum
CREATE TYPE "AIValidationStatus" AS ENUM ('VALID', 'QUARANTINED', 'FAILED');

-- CreateEnum
CREATE TYPE "AIReviewDecision" AS ENUM ('ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT', 'QUARANTINE', 'NEEDS_SOURCE_WORK', 'NEEDS_RIGHTS_REVIEW');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disclaimer" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "ContentType" NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "workingTitle" TEXT NOT NULL,
    "publicTitle" TEXT,
    "slug" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'IDEA',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "urgency" INTEGER NOT NULL DEFAULT 3,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "searchValue" INTEGER NOT NULL DEFAULT 3,
    "longTermValue" INTEGER NOT NULL DEFAULT 3,
    "audienceIntent" TEXT,
    "viewerPromise" TEXT,
    "searchQuery" TEXT,
    "browsePromise" TEXT,
    "spoilerLevel" "SpoilerLevel" NOT NULL DEFAULT 'NONE',
    "platformScope" TEXT,
    "targetLength" TEXT,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "notBeforeAt" TIMESTAMP(3),
    "updateTrigger" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRelation" (
    "id" TEXT NOT NULL,
    "fromContentId" TEXT NOT NULL,
    "toContentId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,

    CONSTRAINT "ContentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentStatusHistory" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "fromStatus" "ContentStatus",
    "toStatus" "ContentStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "url" TEXT,
    "sourceClass" "SourceClass" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "publicationDate" TIMESTAMP(3),
    "retrievalDate" TIMESTAMP(3),
    "factualAsOfDate" TIMESTAMP(3),
    "inspectedLocation" TEXT,
    "supportNotes" TEXT,
    "archiveReference" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "staleAfter" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "classification" "ClaimClassification" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 3,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PROPOSED',
    "publicWording" TEXT,
    "contradictionGroupId" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimSource" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "supportType" TEXT NOT NULL,
    "supportText" TEXT,
    "exactLocation" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ClaimSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentClaim" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'SUPPORTING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "angle" TEXT,
    "allowedClaimIds" TEXT[],
    "prohibitedAssertions" TEXT[],
    "structure" TEXT,
    "callToAction" TEXT,
    "visualPlan" TEXT,
    "rightsNotes" TEXT,
    "successMetric" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "structuredBodyJson" JSONB,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedDuration" INTEGER NOT NULL DEFAULT 0,
    "authorType" TEXT NOT NULL DEFAULT 'HUMAN',
    "createdBy" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemText" TEXT NOT NULL,
    "userTemplate" TEXT NOT NULL,
    "outputSchema" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIGeneration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentId" TEXT,
    "taskType" "AITaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTemplateKey" TEXT NOT NULL,
    "promptTemplateVersion" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "sourceIds" TEXT[],
    "claimIds" TEXT[],
    "requestJson" JSONB NOT NULL,
    "responseJson" JSONB,
    "validationStatus" "AIValidationStatus" NOT NULL,
    "quarantineReason" TEXT,
    "tokenUsage" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewDecision" "AIReviewDecision",

    CONSTRAINT "AIGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "location" TEXT,
    "ownership" "AssetOwnership" NOT NULL DEFAULT 'ORIGINAL',
    "ownerName" TEXT,
    "sourceUrl" TEXT,
    "intendedUse" TEXT,
    "licenseBasis" TEXT,
    "amountUsed" TEXT,
    "transformation" TEXT,
    "containsMusic" BOOLEAN NOT NULL DEFAULT false,
    "spoilerLevel" "SpoilerLevel" NOT NULL DEFAULT 'NONE',
    "flagLeaked" BOOLEAN NOT NULL DEFAULT false,
    "flagFakeTrailer" BOOLEAN NOT NULL DEFAULT false,
    "flagIsolatedCutscene" BOOLEAN NOT NULL DEFAULT false,
    "flagUnlicensedMusic" BOOLEAN NOT NULL DEFAULT false,
    "flagMassProducedAI" BOOLEAN NOT NULL DEFAULT false,
    "flagDeceptive" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsReview" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "riskLevel" "RightsRisk" NOT NULL,
    "decision" "RightsDecision" NOT NULL,
    "notes" TEXT,
    "reviewerId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "RightsReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleVariant" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'SEARCH_FIRST',
    "classificationBadge" TEXT,
    "deceptionCheck" BOOLEAN NOT NULL DEFAULT false,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThumbnailVariant" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "imageLocation" TEXT,
    "strategy" TEXT NOT NULL DEFAULT 'BROWSE_FIRST',
    "mobileCheck" BOOLEAN NOT NULL DEFAULT false,
    "deceptionCheck" BOOLEAN NOT NULL DEFAULT false,
    "trademarkCheck" BOOLEAN NOT NULL DEFAULT false,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThumbnailVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "scope" "ApprovalScope" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "notes" TEXT,
    "actorId" TEXT NOT NULL,
    "contentRevisionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "channel" "PublicationChannel" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publicUrl" TEXT,
    "externalId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicArticleRevision" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "claimSnapshot" JSONB NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "spoilerLevel" "SpoilerLevel" NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "severity" "CorrectionSeverity" NOT NULL,
    "originalText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceId" TEXT,
    "publicNotice" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'REPORTED',
    "createdBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateTask" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerReference" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "UpdateTaskStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER,
    "views" INTEGER,
    "ctr" DOUBLE PRECISION,
    "firstThirtySecondRetention" DOUBLE PRECISION,
    "averagePercentageViewed" DOUBLE PRECISION,
    "watchHours" DOUBLE PRECISION,
    "subscribersGained" INTEGER,
    "shortsToLongClicks" INTEGER,
    "trafficSourcesJson" JSONB,
    "revenueJson" JSONB,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadataJson" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_userId_workspaceId_role_key" ON "RoleAssignment"("userId", "workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_workspaceId_slug_key" ON "ContentItem"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRelation_fromContentId_toContentId_relationType_key" ON "ContentRelation"("fromContentId", "toContentId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSource_claimId_sourceId_key" ON "ClaimSource"("claimId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentClaim_contentId_claimId_key" ON "ContentClaim"("contentId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBrief_contentId_version_key" ON "ContentBrief"("contentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptVersion_contentId_version_key" ON "ScriptVersion"("contentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_contentId_channel_key" ON "Publication"("contentId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PublicArticleRevision_contentId_revision_key" ON "PublicArticleRevision"("contentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PublicArticleRevision_slug_revision_key" ON "PublicArticleRevision"("slug", "revision");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_fromContentId_fkey" FOREIGN KEY ("fromContentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_toContentId_fkey" FOREIGN KEY ("toContentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentStatusHistory" ADD CONSTRAINT "ContentStatusHistory_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentClaim" ADD CONSTRAINT "ContentClaim_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentClaim" ADD CONSTRAINT "ContentClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneration" ADD CONSTRAINT "AIGeneration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneration" ADD CONSTRAINT "AIGeneration_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsReview" ADD CONSTRAINT "RightsReview_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleVariant" ADD CONSTRAINT "TitleVariant_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThumbnailVariant" ADD CONSTRAINT "ThumbnailVariant_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicArticleRevision" ADD CONSTRAINT "PublicArticleRevision_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateTask" ADD CONSTRAINT "UpdateTask_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Critical invariants (docs/04_DATA_MODEL.md "Critical constraints").
-- Enforced in the database so they hold regardless of application code paths.
-- ============================================================================

-- 1. Append-only audit log: block UPDATE and DELETE on "AuditEvent".
CREATE OR REPLACE FUNCTION fg_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are immutable and cannot be % via the application',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION fg_block_mutation();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION fg_block_mutation();

-- 2. Public article revisions are immutable snapshots: block UPDATE and DELETE.
CREATE TRIGGER public_revision_no_update
  BEFORE UPDATE ON "PublicArticleRevision"
  FOR EACH ROW EXECUTE FUNCTION fg_block_mutation();

CREATE TRIGGER public_revision_no_delete
  BEFORE DELETE ON "PublicArticleRevision"
  FOR EACH ROW EXECUTE FUNCTION fg_block_mutation();

-- 3. LEAKED claims are always quarantined and can never be marked reviewed.
ALTER TABLE "Claim"
  ADD CONSTRAINT claim_leaked_must_be_quarantined
  CHECK (classification <> 'LEAKED' OR status = 'QUARANTINED');

-- 4. LEAKED claims cannot be linked to any content item (blocks publishable use).
CREATE OR REPLACE FUNCTION fg_block_leaked_content_claim() RETURNS trigger AS $$
DECLARE
  cls "ClaimClassification";
BEGIN
  SELECT classification INTO cls FROM "Claim" WHERE id = NEW."claimId";
  IF cls = 'LEAKED' THEN
    RAISE EXCEPTION 'LEAKED claim % cannot be linked to content', NEW."claimId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_claim_no_leaked
  BEFORE INSERT OR UPDATE ON "ContentClaim"
  FOR EACH ROW EXECUTE FUNCTION fg_block_leaked_content_claim();

-- 5. Approvals must carry a non-empty content revision hash (ties approval to a state).
ALTER TABLE "Approval"
  ADD CONSTRAINT approval_revision_hash_present
  CHECK (length("contentRevisionHash") > 0);

-- 6. A published public-website Publication must record a public URL.
ALTER TABLE "Publication"
  ADD CONSTRAINT publication_published_needs_url
  CHECK (status <> 'PUBLISHED' OR "publicUrl" IS NOT NULL);
