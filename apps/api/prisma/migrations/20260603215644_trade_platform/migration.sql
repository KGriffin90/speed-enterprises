/*
  Warnings:

  - A unique constraint covering the columns `[dbName]` on the table `Tenant` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TenantDbStatus" AS ENUM ('NONE', 'PROVISIONING', 'MIGRATING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "dbConnectionEnc" TEXT,
ADD COLUMN     "dbHost" TEXT,
ADD COLUMN     "dbName" TEXT,
ADD COLUMN     "dbProvisionedAt" TIMESTAMP(3),
ADD COLUMN     "dbStatus" "TenantDbStatus" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_dbName_key" ON "Tenant"("dbName");
