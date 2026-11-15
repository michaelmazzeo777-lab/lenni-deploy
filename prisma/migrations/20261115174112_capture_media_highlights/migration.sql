-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('PS5_NATIVE_USB', 'CAPTURE_CARD_OBS', 'SYNTHETIC_FIXTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaRightsStatus" AS ENUM ('OWNED_ORIGINAL_CAPTURE', 'INTERNAL_FIXTURE', 'UNCLEARED');

-- CreateEnum
CREATE TYPE "HighlightStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ShortsRender" ADD COLUMN     "bundlePath" TEXT,
ADD COLUMN     "checksumSha256" TEXT,
ADD COLUMN     "format" TEXT NOT NULL DEFAULT '9:16',
ADD COLUMN     "isFixture" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manifestJson" JSONB;

-- AlterTable
ALTER TABLE "ShortsScript" ADD COLUMN     "highlightCandidateId" TEXT;

-- AlterTable
ALTER TABLE "ShortsVoiceover" ADD COLUMN     "cuesJson" JSONB,
ADD COLUMN     "isFixture" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CaptureMedia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "gameMode" TEXT,
    "captureMethod" "CaptureMethod" NOT NULL,
    "sourceDevice" TEXT NOT NULL,
    "audioNotes" TEXT,
    "rightsStatus" "MediaRightsStatus" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "frameRate" DOUBLE PRECISION NOT NULL,
    "videoCodec" TEXT NOT NULL,
    "audioCodec" TEXT,
    "probeJson" JSONB NOT NULL,
    "ingestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HighlightCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "peakSec" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "signalsJson" JSONB NOT NULL,
    "thumbnailPath" TEXT,
    "status" "HighlightStatus" NOT NULL DEFAULT 'PENDING',
    "trimStartSec" DOUBLE PRECISION,
    "trimEndSec" DOUBLE PRECISION,
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "analyzerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighlightCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureMedia_captureSessionId_key" ON "CaptureMedia"("captureSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureMedia_workspaceId_checksumSha256_key" ON "CaptureMedia"("workspaceId", "checksumSha256");

-- CreateIndex
CREATE INDEX "HighlightCandidate_captureSessionId_status_idx" ON "HighlightCandidate"("captureSessionId", "status");

-- AddForeignKey
ALTER TABLE "ShortsScript" ADD CONSTRAINT "ShortsScript_highlightCandidateId_fkey" FOREIGN KEY ("highlightCandidateId") REFERENCES "HighlightCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureMedia" ADD CONSTRAINT "CaptureMedia_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightCandidate" ADD CONSTRAINT "HighlightCandidate_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
