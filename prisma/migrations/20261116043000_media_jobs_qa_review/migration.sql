-- CreateEnum
CREATE TYPE "CaptureKind" AS ENUM ('GAMEPLAY', 'GRAPHICS');

-- CreateEnum
CREATE TYPE "MediaClass" AS ENUM ('ENGINEERING_FIXTURE', 'ILLUSTRATIVE_DRAFT', 'GAMEPLAY_CAPTURE');

-- CreateEnum
CREATE TYPE "RenderReviewState" AS ENUM ('RENDERED', 'QA_CHECKED', 'PENDING_MIKE_REVIEW', 'MIKE_APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaJobKind" AS ENUM ('NARRATION', 'RENDER');

-- CreateEnum
CREATE TYPE "MediaJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "CaptureSession" ADD COLUMN     "kind" "CaptureKind" NOT NULL DEFAULT 'GAMEPLAY';

-- AlterTable
ALTER TABLE "ShortsRender" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "approvedChecksum" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "mediaClass" "MediaClass",
ADD COLUMN     "qaJson" JSONB,
ADD COLUMN     "reviewState" "RenderReviewState";

-- AlterTable
ALTER TABLE "ShortsScript" ADD COLUMN     "cardsJson" JSONB;

-- AlterTable
ALTER TABLE "ShortsVoiceover" ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qaJson" JSONB,
ADD COLUMN     "voiceLicenseNote" TEXT,
ADD COLUMN     "voiceName" TEXT;

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "MediaJobKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "failureJson" JSONB,
    "resultId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaJob_workspaceId_subjectId_idx" ON "MediaJob"("workspaceId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaJob_workspaceId_kind_idempotencyKey_key" ON "MediaJob"("workspaceId", "kind", "idempotencyKey");

