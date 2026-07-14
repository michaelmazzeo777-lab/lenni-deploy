-- CreateEnum
CREATE TYPE "QuarantineStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED');

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT,
    "visualAssetId" TEXT,
    "originalName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "quarantineStatus" "QuarantineStatus" NOT NULL DEFAULT 'PENDING',
    "scanNotes" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_assetId_key" ON "StoredFile"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_visualAssetId_key" ON "StoredFile"("visualAssetId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_visualAssetId_fkey" FOREIGN KEY ("visualAssetId") REFERENCES "VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Local file storage containment constraints.
-- ============================================================================

-- Exactly one owner (Asset xor VisualAsset) per stored file.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT stored_file_single_owner
  CHECK (
    (CASE WHEN "assetId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "visualAssetId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- A file cannot be scanned as CLEAN without a scannedAt timestamp, and a
-- freshly uploaded PENDING file must not already carry one.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT stored_file_scan_timestamp_consistent
  CHECK (
    ("quarantineStatus" = 'PENDING' AND "scannedAt" IS NULL)
    OR ("quarantineStatus" IN ('CLEAN', 'REJECTED') AND "scannedAt" IS NOT NULL)
  );
