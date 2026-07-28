-- Saved routes (route templates) gain a recurrence schedule anchor + a default
-- crew, and generated routes link back to their source template so the
-- recurrence scheduler can de-duplicate (one route per template per day).

-- 1. Schedule anchor: the first day a recurring saved route should run. The
--    cadence (weekday / day-of-month / interval) is derived from this date.
ALTER TABLE "RouteTemplate" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);

-- 2. Backlink from a generated route to the saved route it came from.
ALTER TABLE "WorkRoute" ADD COLUMN IF NOT EXISTS "sourceTemplateId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkRoute_tenantId_sourceTemplateId_plannedForDate_idx"
  ON "WorkRoute"("tenantId","sourceTemplateId","plannedForDate");

-- 3. Default crew for a saved route (mirrors RouteAssignee; tenantId is a plain
--    cross-DB column with no FK to the catalog).
CREATE TABLE IF NOT EXISTS "RouteTemplateAssignee" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteTemplateAssignee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RouteTemplateAssignee_templateId_membershipId_key" ON "RouteTemplateAssignee"("templateId","membershipId");
CREATE INDEX IF NOT EXISTS "RouteTemplateAssignee_tenantId_membershipId_idx" ON "RouteTemplateAssignee"("tenantId","membershipId");
CREATE INDEX IF NOT EXISTS "RouteTemplateAssignee_membershipId_idx" ON "RouteTemplateAssignee"("membershipId");
DO $$ BEGIN
  ALTER TABLE "RouteTemplateAssignee" ADD CONSTRAINT "RouteTemplateAssignee_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RouteTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
