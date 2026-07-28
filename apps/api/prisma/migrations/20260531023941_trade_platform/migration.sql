-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'SALARY');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EDITED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TIME_ENTRY_EDITED';
ALTER TYPE "AuditAction" ADD VALUE 'PAY_RATE_UPDATED';

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "basePayCents" INTEGER NOT NULL DEFAULT 0,
    "payType" "PayType" NOT NULL DEFAULT 'HOURLY',
    "avgMpg" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "vehicleNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "clockedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockedOutAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "notesByStaff" TEXT,
    "notesByAdmin" TEXT,
    "adminEditedAt" TIMESTAMP(3),
    "adminEditorId" TEXT,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "distanceMiles" DOUBLE PRECISION,
    "gallonsUsed" DOUBLE PRECISION,

    CONSTRAINT "WorkRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteWaypoint" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteWaypoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_membershipId_key" ON "EmployeeProfile"("membershipId");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_clockedInAt_idx" ON "TimeEntry"("tenantId", "clockedInAt" DESC);

-- CreateIndex
CREATE INDEX "TimeEntry_membershipId_clockedInAt_idx" ON "TimeEntry"("membershipId", "clockedInAt" DESC);

-- CreateIndex
CREATE INDEX "WorkRoute_tenantId_startedAt_idx" ON "WorkRoute"("tenantId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "WorkRoute_membershipId_idx" ON "WorkRoute"("membershipId");

-- CreateIndex
CREATE INDEX "RouteWaypoint_routeId_recordedAt_idx" ON "RouteWaypoint"("routeId", "recordedAt");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRoute" ADD CONSTRAINT "WorkRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRoute" ADD CONSTRAINT "WorkRoute_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRoute" ADD CONSTRAINT "WorkRoute_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteWaypoint" ADD CONSTRAINT "RouteWaypoint_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "WorkRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
