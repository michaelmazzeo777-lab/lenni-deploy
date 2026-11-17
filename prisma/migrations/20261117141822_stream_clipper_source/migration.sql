-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaJobKind" ADD VALUE 'STREAM_INGEST';
ALTER TYPE "MediaJobKind" ADD VALUE 'STREAM_CLIP';

-- AlterTable
ALTER TABLE "SessionClip" ADD COLUMN     "cropModeUsed" TEXT,
ADD COLUMN     "hookTitle" TEXT,
ADD COLUMN     "postKitPath" TEXT,
ADD COLUMN     "sourceStartSec" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "StreamSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelHandle" TEXT,
    "title" TEXT,
    "streamDurationSec" DOUBLE PRECISION,
    "audioPath" TEXT,
    "audioBytes" BIGINT,
    "downloadedBytes" BIGINT NOT NULL DEFAULT 0,
    "allowlistEntry" TEXT,
    "unlistedApprovedBy" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamSource_captureSessionId_key" ON "StreamSource"("captureSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamSource_workspaceId_platform_videoId_key" ON "StreamSource"("workspaceId", "platform", "videoId");

-- AddForeignKey
ALTER TABLE "StreamSource" ADD CONSTRAINT "StreamSource_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
