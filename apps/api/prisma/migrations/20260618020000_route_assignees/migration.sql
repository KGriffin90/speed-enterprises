-- Multi-employee route assignment (crew).
CREATE TABLE IF NOT EXISTS "RouteAssignee" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteAssignee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RouteAssignee_routeId_membershipId_key" ON "RouteAssignee"("routeId","membershipId");
CREATE INDEX IF NOT EXISTS "RouteAssignee_tenantId_membershipId_idx" ON "RouteAssignee"("tenantId","membershipId");
CREATE INDEX IF NOT EXISTS "RouteAssignee_membershipId_idx" ON "RouteAssignee"("membershipId");
DO $$ BEGIN
  ALTER TABLE "RouteAssignee" ADD CONSTRAINT "RouteAssignee_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "WorkRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill: make every existing planned route's primary membership an assignee.
INSERT INTO "RouteAssignee" ("id", "routeId", "tenantId", "membershipId", "createdAt")
SELECT 'ra_' || "id", "id", "tenantId", "membershipId", now()
FROM "WorkRoute"
WHERE NOT EXISTS (SELECT 1 FROM "RouteAssignee" ra WHERE ra."routeId" = "WorkRoute"."id" AND ra."membershipId" = "WorkRoute"."membershipId");
