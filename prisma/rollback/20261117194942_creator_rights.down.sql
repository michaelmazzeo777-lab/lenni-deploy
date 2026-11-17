-- Rollback for migration 20261117194942_creator_rights (candidate only).
-- Removes the creator-rights tables and the optional provenance columns on
-- CaptureMedia. Run only after exporting any creator/agreement records you
-- want to keep; then delete the matching row from _prisma_migrations.
ALTER TABLE "CaptureMedia" DROP CONSTRAINT IF EXISTS "CaptureMedia_agreementId_fkey";
ALTER TABLE "CaptureMedia"
  DROP COLUMN IF EXISTS "agreementId",
  DROP COLUMN IF EXISTS "rightsReviewDecision",
  DROP COLUMN IF EXISTS "rightsReviewNote",
  DROP COLUMN IF EXISTS "rightsReviewedBy",
  DROP COLUMN IF EXISTS "rightsReviewedAt",
  DROP COLUMN IF EXISTS "thirdPartyNotes";
DROP TABLE IF EXISTS "AgreementEvent";
DROP TABLE IF EXISTS "CreatorAgreement";
DROP TABLE IF EXISTS "Creator";
DROP TYPE IF EXISTS "AgreementStatus";
DROP TYPE IF EXISTS "CreatorStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261117194942_creator_rights';
