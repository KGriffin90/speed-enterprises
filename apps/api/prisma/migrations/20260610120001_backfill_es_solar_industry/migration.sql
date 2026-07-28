-- Reclassify the es-solar tenant from OTHER to the new SOLAR industry.
-- (Separate migration from the enum addition — see note there.)
UPDATE "Tenant" SET "industry" = 'SOLAR' WHERE "slug" = 'es-solar';
