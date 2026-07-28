import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'production'
        ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
        : [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'info' },
            { emit: 'event', level: 'query' },
          ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside a transaction with Postgres RLS settings applied. The
   * RLS policies (see prisma/sql/01-row-level-security.sql) check
   * `app.tenant_id` and `app.is_platform_admin` GUCs; we set them here.
   * Using SET LOCAL means they reset when the transaction commits or rolls
   * back, so there's no leakage between requests.
   */
  async withTenantTx<T>(
    opts: { tenantId?: string | null; isPlatformAdmin?: boolean },
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      if (opts.tenantId) {
        // set_config(setting, new_value, is_local) — is_local=true makes it transaction-scoped.
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          opts.tenantId,
        );
      }
      if (opts.isPlatformAdmin) {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.is_platform_admin', 'true', true)`,
        );
      }
      return fn(tx);
    });
  }
}
