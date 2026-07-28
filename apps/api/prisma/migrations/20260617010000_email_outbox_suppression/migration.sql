-- Transactional email outbox fields + platform-wide suppression list (Postmark).
ALTER TYPE "EmailStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "bodyText" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
CREATE INDEX IF NOT EXISTS "EmailLog_status_nextAttemptAt_idx" ON "EmailLog"("status","nextAttemptAt");

CREATE TABLE IF NOT EXISTS "EmailSuppression" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailSuppression_email_key" ON "EmailSuppression"("email");
