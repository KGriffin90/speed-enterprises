import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /** Landing endpoint — discoverable summary of what's running and where. */
  @Get('/')
  async root() {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] }, slug: { not: '_platform' } },
      select: { slug: true, industry: true, config: { select: { businessName: true } } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []);

    const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
    return {
      name:    process.env.PLATFORM_NAME ?? 'Speed Enterprises',
      version: process.env.npm_package_version ?? '0.1.0',
      env:     process.env.NODE_ENV ?? 'development',
      docs:    `${origin}/docs`,
      health:  `${origin}/health`,
      tenants: tenants.map(t => ({
        slug:         t.slug,
        businessName: t.config?.businessName ?? t.slug,
        industry:     t.industry,
        configUrl:    `${origin}/api/config/${t.slug}`,
      })),
      hint: 'Try /docs for Swagger, /api/config/:slug for a tenant\'s full BusinessConfig, or POST /api/auth/login.',
    };
  }

  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', uptimeSec: Math.round(process.uptime()) };
    } catch {
      return { status: 'degraded', db: 'down', uptimeSec: Math.round(process.uptime()) };
    }
  }

  @Get('version')
  version() {
    return {
      name:    'speed-enterprises-api',
      version: process.env.npm_package_version ?? '0.0.0',
      node:    process.version,
      env:     process.env.NODE_ENV ?? 'development',
    };
  }
}
