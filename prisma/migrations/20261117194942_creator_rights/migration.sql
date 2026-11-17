-- CreateEnum
CREATE TYPE "CreatorStatus" AS ENUM ('PROSPECT', 'QUALIFIED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('AGREEMENT_DRAFT', 'LEGAL_REVIEW', 'APPROVED_TO_CONTACT', 'SENT', 'NEGOTIATING', 'EXECUTED_VERIFIED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED');

-- AlterTable
ALTER TABLE "CaptureMedia" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "rightsReviewDecision" TEXT,
ADD COLUMN     "rightsReviewNote" TEXT,
ADD COLUMN     "rightsReviewedAt" TIMESTAMP(3),
ADD COLUMN     "rightsReviewedBy" TEXT,
ADD COLUMN     "thirdPartyNotes" TEXT;

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "tier" TEXT,
    "games" TEXT[],
    "categories" TEXT[],
    "audienceNote" TEXT,
    "audienceSource" TEXT,
    "businessContact" TEXT,
    "contactSource" TEXT,
    "fitNotes" TEXT,
    "rightsComplications" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" "CreatorStatus" NOT NULL DEFAULT 'PROSPECT',
    "qualifiedEvidence" TEXT,
    "nextAction" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAgreement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'AGREEMENT_DRAFT',
    "templateVersion" TEXT,
    "rightsOwner" TEXT,
    "ownershipEvidence" TEXT,
    "footageScope" TEXT,
    "editingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "derivativesAllowed" BOOLEAN NOT NULL DEFAULT false,
    "approvedDestinations" TEXT[],
    "commercialUse" BOOLEAN NOT NULL DEFAULT false,
    "monetizationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attribution" TEXT,
    "compensationTerms" TEXT,
    "excludedRights" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "legalReviewer" TEXT,
    "legalReviewNote" TEXT,
    "legalReviewedAt" TIMESTAMP(3),
    "signatureEvidence" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementEvent" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "fromStatus" "AgreementStatus",
    "toStatus" "AgreementStatus" NOT NULL,
    "evidence" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "affectedJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_workspaceId_profileUrl_key" ON "Creator"("workspaceId", "profileUrl");

-- CreateIndex
CREATE INDEX "CreatorAgreement_workspaceId_status_idx" ON "CreatorAgreement"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AgreementEvent_agreementId_createdAt_idx" ON "AgreementEvent"("agreementId", "createdAt");

-- AddForeignKey
ALTER TABLE "CaptureMedia" ADD CONSTRAINT "CaptureMedia_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreatorAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAgreement" ADD CONSTRAINT "CreatorAgreement_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementEvent" ADD CONSTRAINT "AgreementEvent_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreatorAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
