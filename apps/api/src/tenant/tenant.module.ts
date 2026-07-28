import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantService } from './tenant.service';
import { TenantContext } from './tenant-context';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
        signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
      }),
    }),
  ],
  providers: [TenantService, TenantContext, TenantMiddleware, TenantPrismaService],
  exports:   [TenantService, TenantContext, TenantMiddleware, TenantPrismaService, JwtModule],
})
export class TenantModule {}
