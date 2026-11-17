-- Background premium-render jobs: a new job kind, a CANCELED state, and the
-- fields a long-running job needs. Additive only.
ALTER TYPE "MediaJobKind" ADD VALUE 'PREMIUM_RENDER';
ALTER TYPE "MediaJobStatus" ADD VALUE 'CANCELED';
ALTER TABLE "MediaJob"
  ADD COLUMN "progress" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "pid" INTEGER;
