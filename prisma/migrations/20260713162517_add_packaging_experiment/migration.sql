-- CreateTable
CREATE TABLE "PackagingExperiment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variantAId" TEXT NOT NULL,
    "variantBId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "result" TEXT,
    "conclusion" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingExperiment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PackagingExperiment" ADD CONSTRAINT "PackagingExperiment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
