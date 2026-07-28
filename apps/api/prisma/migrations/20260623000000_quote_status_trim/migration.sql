-- Trim QuoteStatus to the active lifecycle: drop ACCEPTED, INVOICED, EXPIRED
-- (keep PAID). Existing rows on the removed values are remapped first:
--   ACCEPTED  -> ESTIMATE_SENT  (estimate approval no longer a distinct state)
--   INVOICED  -> COMPLETED
--   EXPIRED   -> CANCELED

-- 1) Remap rows off the values being removed.
UPDATE "QuoteRequest" SET "status" = 'ESTIMATE_SENT' WHERE "status" = 'ACCEPTED';
UPDATE "QuoteRequest" SET "status" = 'COMPLETED'     WHERE "status" = 'INVOICED';
UPDATE "QuoteRequest" SET "status" = 'CANCELED'      WHERE "status" = 'EXPIRED';

UPDATE "QuoteStatusHistory" SET "fromStatus" = 'ESTIMATE_SENT' WHERE "fromStatus" = 'ACCEPTED';
UPDATE "QuoteStatusHistory" SET "fromStatus" = 'COMPLETED'     WHERE "fromStatus" = 'INVOICED';
UPDATE "QuoteStatusHistory" SET "fromStatus" = 'CANCELED'      WHERE "fromStatus" = 'EXPIRED';
UPDATE "QuoteStatusHistory" SET "toStatus"   = 'ESTIMATE_SENT' WHERE "toStatus"   = 'ACCEPTED';
UPDATE "QuoteStatusHistory" SET "toStatus"   = 'COMPLETED'     WHERE "toStatus"   = 'INVOICED';
UPDATE "QuoteStatusHistory" SET "toStatus"   = 'CANCELED'      WHERE "toStatus"   = 'EXPIRED';

-- 2) Recreate the enum without the removed values.
ALTER TYPE "QuoteStatus" RENAME TO "QuoteStatus_old";
CREATE TYPE "QuoteStatus" AS ENUM ('NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELED');

-- 3) Swap columns over to the new type (drop/re-add the default around the cast).
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" TYPE "QuoteStatus" USING ("status"::text::"QuoteStatus");
ALTER TABLE "QuoteStatusHistory" ALTER COLUMN "fromStatus" TYPE "QuoteStatus" USING ("fromStatus"::text::"QuoteStatus");
ALTER TABLE "QuoteStatusHistory" ALTER COLUMN "toStatus" TYPE "QuoteStatus" USING ("toStatus"::text::"QuoteStatus");
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "QuoteStatus_old";
