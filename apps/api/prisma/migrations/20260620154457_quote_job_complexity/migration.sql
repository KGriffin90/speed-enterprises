-- CreateEnum
CREATE TYPE "JobComplexity" AS ENUM ('SIMPLE', 'COMPLEX');

-- AlterTable
ALTER TABLE "QuoteRequest" ADD COLUMN     "complexityNote" TEXT,
ADD COLUMN     "jobComplexity" "JobComplexity";
