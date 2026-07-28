-- Add SOLAR to the Industry enum.
-- NOTE: a value added to a Postgres enum cannot be *used* in the same
-- transaction it was added in, so the es-solar backfill lives in the next
-- migration (each migration runs in its own transaction).
ALTER TYPE "Industry" ADD VALUE 'SOLAR' BEFORE 'OTHER';
