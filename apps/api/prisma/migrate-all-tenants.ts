/**
 * Fan-out migration runner for db-per-tenant deployments.
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/migrate-all-tenants.ts [--dry-run] [--concurrency=4]
 *
 * In a database-per-tenant topology, `prisma migrate deploy` against one
 * DATABASE_URL only migrates ONE tenant. This script walks every READY tenant
 * in the catalog and applies committed migrations to each tenant's database.
 *
 * Guarantees:
 *   • Runs `migrate deploy` (committed migrations only) — never `migrate dev`.
 *   • Bounded concurrency so we don't open hundreds of connections at once.
 *   • Per-tenant status (READY → MIGRATING → READY/FAILED) so a crash is
 *     resumable and a failed tenant is visibly quarantined.
 *   • Continues past a failing tenant but exits non-zero if ANY failed, so CI
 *     and deploy pipelines treat a partial rollout as a failure.
 *
 * RUN ORDER for a schema change:
 *   1. Make the migration BACKWARD-COMPATIBLE (expand, don't break).
 *   2. Deploy the new app code that tolerates old AND new schema.
 *   3. Run this script to migrate all tenant DBs.
 *   4. (Later) ship the contract migration that drops old columns.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { loadTenancyConfig } from '../src/database/tenancy.config';
import { decryptSecret, keyRingFromEnv } from '../src/database/connection-secret';

const execFileAsync = promisify(execFile);

interface Result {
  slug: string;
  ok: boolean;
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 4);

  const cfg = loadTenancyConfig();
  if (cfg.mode !== 'db-per-tenant') {
    console.log('TENANCY_MODE is not db-per-tenant; nothing to fan out. Use `prisma migrate deploy`.');
    return;
  }
  const ring = keyRingFromEnv(process.env.TENANT_SECRET_KEYS);
  const catalog = new PrismaClient({ datasourceUrl: cfg.catalogUrl });

  try {
    const tenants = await catalog.tenant.findMany({
      where: { dbStatus: 'READY', deletedAt: null },
      select: { id: true, slug: true, dbConnectionEnc: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${tenants.length} READY tenant database(s). dryRun=${dryRun} concurrency=${concurrency}`);
    const results: Result[] = [];
    const queue = [...tenants];

    async function worker() {
      while (queue.length) {
        const t = queue.shift()!;
        if (!t.dbConnectionEnc) {
          results.push({ slug: t.slug, ok: false, error: 'no connection secret' });
          continue;
        }
        const url = decryptSecret(t.dbConnectionEnc, ring);
        if (dryRun) {
          console.log(`[dry-run] would migrate ${t.slug}`);
          results.push({ slug: t.slug, ok: true });
          continue;
        }
        try {
          await catalog.tenant.update({ where: { id: t.id }, data: { dbStatus: 'MIGRATING' } });
          await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
            env: { ...process.env, DATABASE_URL: url },
            timeout: 120_000,
          });
          await catalog.tenant.update({ where: { id: t.id }, data: { dbStatus: 'READY' } });
          console.log(`✓ ${t.slug}`);
          results.push({ slug: t.slug, ok: true });
        } catch (err) {
          await catalog.tenant.update({ where: { id: t.id }, data: { dbStatus: 'FAILED' } }).catch(() => {});
          console.error(`✗ ${t.slug}: ${(err as Error).message}`);
          results.push({ slug: t.slug, ok: false, error: (err as Error).message });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

    const failed = results.filter((r) => !r.ok);
    console.log(`\nDone. ${results.length - failed.length} ok, ${failed.length} failed.`);
    if (failed.length) {
      console.error('Failed tenants:', failed.map((f) => f.slug).join(', '));
      process.exitCode = 1;
    }
  } finally {
    await catalog.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
