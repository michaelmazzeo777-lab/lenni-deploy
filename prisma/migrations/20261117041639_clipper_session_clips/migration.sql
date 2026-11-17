-- AlterEnum
ALTER TYPE "MediaJobKind" ADD VALUE 'SESSION_CLIP';

-- CreateTable
CREATE TABLE "SessionClip" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "jobId" TEXT,
    "analysisRunId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "peakSec" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "signalsJson" JSONB NOT NULL,
    "format" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "resolution" TEXT NOT NULL,
    "frameRate" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "bundlePath" TEXT,
    "manifestJson" JSONB,
    "mediaClass" "MediaClass",
    "reviewState" "RenderReviewState",
    "qaJson" JSONB,
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "approvedChecksum" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionClip_captureSessionId_analysisRunId_rank_idx" ON "SessionClip"("captureSessionId", "analysisRunId", "rank");

-- AddForeignKey
ALTER TABLE "SessionClip" ADD CONSTRAINT "SessionClip_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
