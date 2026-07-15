-- DropIndex
DROP INDEX "PromptTemplate_key_version_key";

-- AlterTable
ALTER TABLE "PromptTemplate" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "workspaceId" TEXT NOT NULL,
ALTER COLUMN "userTemplate" SET DEFAULT '',
ALTER COLUMN "outputSchema" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_workspaceId_key_version_key" ON "PromptTemplate"("workspaceId", "key", "version");

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

