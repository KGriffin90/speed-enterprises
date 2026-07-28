import { Injectable } from '@nestjs/common';
import { CatalogPrismaService } from '../database/catalog-prisma.service';

/**
 * Platform-wide email suppression list (catalog DB). An address that hard-bounces
 * or files a spam complaint is recorded here and skipped on every future send,
 * across all tenants. Checked before each send; written by the Postmark webhook.
 */
@Injectable()
export class SuppressionService {
  constructor(private readonly catalog: CatalogPrismaService) {}

  private norm(email: string): string {
    return email.trim().toLowerCase();
  }

  async isSuppressed(email: string): Promise<boolean> {
    const row = await this.catalog.emailSuppression.findUnique({ where: { email: this.norm(email) } });
    return row !== null;
  }

  async suppress(email: string, reason: string, source: string, detail?: string): Promise<void> {
    const e = this.norm(email);
    await this.catalog.emailSuppression.upsert({
      where:  { email: e },
      create: { email: e, reason, source, detail: detail ?? null },
      update: { reason, source, detail: detail ?? null },
    });
  }

  /** Manual unsuppress (e.g., owner confirms an address is valid again). */
  async unsuppress(email: string): Promise<void> {
    await this.catalog.emailSuppression.deleteMany({ where: { email: this.norm(email) } });
  }
}
