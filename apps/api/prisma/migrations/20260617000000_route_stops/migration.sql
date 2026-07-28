-- Planned routes with per-stop arrival/departure timing.
DO $$ BEGIN CREATE TYPE "RouteStatus" AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','CANCELED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RouteStopStatus" AS ENUM ('PENDING','ARRIVED','DONE','SKIPPED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "WorkRoute" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "WorkRoute" ADD COLUMN IF NOT EXISTS "status" "RouteStatus" NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "WorkRoute" ADD COLUMN IF NOT EXISTS "plannedForDate" TIMESTAMP(3);
ALTER TABLE "WorkRoute" ADD COLUMN IF NOT EXISTS "assignedById" TEXT;

CREATE TABLE IF NOT EXISTS "RouteStop" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "addressLine" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postalCode" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "quoteRequestId" TEXT,
  "status" "RouteStopStatus" NOT NULL DEFAULT 'PENDING',
  "arrivedAt" TIMESTAMP(3),
  "departedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RouteStop_routeId_sequence_idx" ON "RouteStop"("routeId","sequence");
CREATE INDEX IF NOT EXISTS "RouteStop_tenantId_idx" ON "RouteStop"("tenantId");
DO $$ BEGIN
  ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "WorkRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
