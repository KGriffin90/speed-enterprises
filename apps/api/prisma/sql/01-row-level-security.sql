-- ───────────────────────────────────────────────────────────────────────────
-- Row-Level Security: defense in depth for tenant isolation.
--
-- Apply once after `prisma migrate`:
--   pnpm --filter @speed-enterprises/api db:rls
--
-- How it works:
--   1. Every tenant-scoped table has RLS enabled.
--   2. Policies allow access only when the current GUC `app.tenant_id`
--      matches the row's `tenantId` column.
--   3. A second policy allows `app.is_platform_admin = true` to read/write
--      anything (audited via AuditLog at the application layer).
--   4. The Postgres role used by Prisma is granted on each table but cannot
--      bypass RLS (FORCE ROW LEVEL SECURITY is set so even the table owner
--      respects policies).
--   5. At the start of every API request, TenantContext + TenantPrismaService
--      run `SET LOCAL app.tenant_id = '<id>'` and (for platform admins)
--      `SET LOCAL app.is_platform_admin = 'true'`. The transaction commits or
--      aborts, and the GUC resets — no leakage between requests.
--
-- Idempotent: rerunning ALTERs is a no-op when already enabled; we DROP IF
-- EXISTS before each CREATE POLICY so policy bodies can be tweaked freely.
-- ───────────────────────────────────────────────────────────────────────────

-- Helper: the list of tenant-scoped tables. Keep in sync with
-- apps/api/src/tenant/tenant-prisma.service.ts → TENANT_SCOPED_MODELS.
--
-- Note: Prisma quotes table names by default ("TenantConfig", "QuoteRequest",
-- etc.) so we quote them here too.

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'TenantConfig',
    'TenantMembership',
    'CustomerProfile',
    'Service',
    'AutomationTemplate',
    'QuoteRequest',
    'QuoteLineItem',
    'UploadedImage',
    'QuoteStatusHistory',
    'EmailLog',
    'AuditLog'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    -- FORCE applies the policies even to the table owner — important because
    -- Prisma typically runs as the owning role.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    -- Drop and recreate the tenant policy so this file is editable + reapplyable.
    -- Build the policy name first, then quote the WHOLE identifier with %I, so we
    -- get "TenantConfig_tenant_isolation" — not "TenantConfig"_tenant_isolation.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING ("tenantId" = current_setting(''app.tenant_id'', true))
         WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true));',
      tbl || '_tenant_isolation', tbl
    );

    -- Platform-admin bypass policy. Reads "app.is_platform_admin" and matches
    -- anything when true. Audited at the application layer.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_platform_admin', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING (current_setting(''app.is_platform_admin'', true) = ''true'')
         WITH CHECK (current_setting(''app.is_platform_admin'', true) = ''true'');',
      tbl || '_platform_admin', tbl
    );
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Verification queries (run by db:rls after applying)
-- ───────────────────────────────────────────────────────────────────────────
-- forcerowsecurity is not exposed by the pg_tables view; read both flags from
-- pg_class (relrowsecurity / relforcerowsecurity) joined to its schema.
SELECT n.nspname                AS schemaname,
       c.relname                AS tablename,
       c.relrowsecurity         AS rowsecurity,
       c.relforcerowsecurity    AS forcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relname IN (
    'TenantConfig','TenantMembership','CustomerProfile','Service',
    'AutomationTemplate','QuoteRequest','QuoteLineItem','UploadedImage',
    'QuoteStatusHistory','EmailLog','AuditLog'
  )
ORDER BY c.relname;
