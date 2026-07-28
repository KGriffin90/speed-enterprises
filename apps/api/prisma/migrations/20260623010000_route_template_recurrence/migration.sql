-- Route templates gain a recurrence cadence (NONE = one-off). Existing templates
-- default to NONE.
CREATE TYPE "RouteRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');
ALTER TABLE "RouteTemplate" ADD COLUMN "recurrence" "RouteRecurrence" NOT NULL DEFAULT 'NONE';
