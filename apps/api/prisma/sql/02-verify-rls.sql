-- Run after 01-row-level-security.sql to prove RLS works.
-- This script attempts a cross-tenant read with no GUC set and expects to see
-- zero rows. If it sees rows, RLS is misconfigured.

BEGIN;
  -- No GUC set → should see nothing from QuoteRequest
  SET LOCAL ROLE postgres;
  RESET ALL;
  SELECT count(*) AS visible_quotes_without_guc FROM "QuoteRequest";

  -- Set a bogus tenant id → still nothing
  SELECT set_config('app.tenant_id', '___nonexistent___', true);
  SELECT count(*) AS visible_quotes_bogus_tenant FROM "QuoteRequest";

  -- Set platform-admin bypass → should see all rows
  SELECT set_config('app.is_platform_admin', 'true', true);
  SELECT count(*) AS visible_quotes_platform_admin FROM "QuoteRequest";
COMMIT;
