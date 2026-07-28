-- CreateEnum
CREATE TYPE "AppointmentMode" AS ENUM ('SELF_SERVE', 'PROPOSED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'RESCHEDULED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_CANCELED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_RESCHEDULED';

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "userId" TEXT,
    "mode" "AppointmentMode" NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL,
    "businessTimezone" TEXT NOT NULL,
    "customerTimezone" TEXT NOT NULL,
    "bookingToken" TEXT,
    "rescheduleToken" TEXT,
    "cancelToken" TEXT,
    "proposedSlots" JSONB,
    "rescheduledFromId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "canceledReason" VARCHAR(500),
    "canceledBy" TEXT,
    "confirmationSentAt" TIMESTAMP(3),
    "reminder24hSentAt" TIMESTAMP(3),
    "reminderMorningSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotHold" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "heldUntil" TIMESTAMP(3) NOT NULL,
    "holdToken" TEXT NOT NULL,

    CONSTRAINT "SlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_bookingToken_key" ON "Appointment"("bookingToken");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_rescheduleToken_key" ON "Appointment"("rescheduleToken");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_cancelToken_key" ON "Appointment"("cancelToken");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_status_idx" ON "Appointment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startAt_idx" ON "Appointment"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_quoteRequestId_idx" ON "Appointment"("tenantId", "quoteRequestId");

-- CreateIndex
CREATE INDEX "Appointment_bookingToken_idx" ON "Appointment"("bookingToken");

-- CreateIndex
CREATE INDEX "Appointment_rescheduleToken_idx" ON "Appointment"("rescheduleToken");

-- CreateIndex
CREATE INDEX "Appointment_cancelToken_idx" ON "Appointment"("cancelToken");

-- CreateIndex
CREATE UNIQUE INDEX "SlotHold_holdToken_key" ON "SlotHold"("holdToken");

-- CreateIndex
CREATE INDEX "SlotHold_heldUntil_idx" ON "SlotHold"("heldUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SlotHold_tenantId_startAt_key" ON "SlotHold"("tenantId", "startAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

