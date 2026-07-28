-- Rename MessageTemplate → AutomationTemplate.
-- A table RENAME preserves all data, foreign keys, and (OID-attached) RLS
-- policies. Indexes/constraints are renamed to keep Prisma's naming convention
-- so future migrations don't drift.
ALTER TABLE "MessageTemplate" RENAME TO "AutomationTemplate";
ALTER TABLE "AutomationTemplate" RENAME CONSTRAINT "MessageTemplate_pkey" TO "AutomationTemplate_pkey";
ALTER TABLE "AutomationTemplate" RENAME CONSTRAINT "MessageTemplate_tenantId_fkey" TO "AutomationTemplate_tenantId_fkey";
ALTER INDEX "MessageTemplate_tenantId_idx" RENAME TO "AutomationTemplate_tenantId_idx";
ALTER INDEX "MessageTemplate_tenantId_kind_channel_key" RENAME TO "AutomationTemplate_tenantId_kind_channel_key";
