-- Consolidate tenant roles to CUSTOMER / STAFF / OWNER.
-- ADMIN is folded into OWNER. Existing ADMIN memberships are migrated to OWNER
-- BEFORE the enum is recreated, so the type cast below cannot fail.

-- AlterEnum
BEGIN;
UPDATE "TenantMembership" SET "role" = 'OWNER' WHERE "role" = 'ADMIN';
CREATE TYPE "TenantRole_new" AS ENUM ('CUSTOMER', 'STAFF', 'OWNER');
ALTER TABLE "TenantMembership" ALTER COLUMN "role" TYPE "TenantRole_new" USING ("role"::text::"TenantRole_new");
ALTER TYPE "TenantRole" RENAME TO "TenantRole_old";
ALTER TYPE "TenantRole_new" RENAME TO "TenantRole";
DROP TYPE "TenantRole_old";
COMMIT;
