-- AlterTable
ALTER TABLE "CaptureSession" ADD COLUMN     "targetsShorts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ShortsScript" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "hookText" TEXT NOT NULL,
    "sectionsJson" JSONB NOT NULL,
    "highlightsJson" JSONB NOT NULL,
    "safetyFlagsJson" JSONB NOT NULL,
    "status" "AIValidationStatus" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortsScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortsVoiceover" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "assetPath" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "duckingJson" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortsVoiceover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortsRender" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "voiceoverId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "resolution" TEXT NOT NULL,
    "frameRate" INTEGER NOT NULL,
    "renderCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "QuarantineStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortsRender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubePublication" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "renderId" TEXT NOT NULL,
    "youtubeVideoId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "disclosureJson" JSONB NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubePublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortsVoiceover_scriptId_key" ON "ShortsVoiceover"("scriptId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubePublication_renderId_key" ON "YouTubePublication"("renderId");

-- AddForeignKey
ALTER TABLE "ShortsScript" ADD CONSTRAINT "ShortsScript_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortsVoiceover" ADD CONSTRAINT "ShortsVoiceover_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "ShortsScript"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortsRender" ADD CONSTRAINT "ShortsRender_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "ShortsScript"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortsRender" ADD CONSTRAINT "ShortsRender_voiceoverId_fkey" FOREIGN KEY ("voiceoverId") REFERENCES "ShortsVoiceover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubePublication" ADD CONSTRAINT "YouTubePublication_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "ShortsRender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

