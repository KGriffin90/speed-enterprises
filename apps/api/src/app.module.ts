import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerConfigService } from './common/throttler-config.service';

import { PrismaModule } from './prisma/prisma.module';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { MessagingModule } from './messaging/messaging.module';

import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ServicesModule } from './services/services.module';
import { QuotesModule } from './quotes/quotes.module';
import { UploadsModule } from './uploads/uploads.module';
import { PlatformModule } from './platform/platform.module';
import { MeModule } from './me/me.module';
import { AutomationsModule } from './automations/automations.module';
import { TeamModule } from './team/team.module';
import { TimeModule } from './time/time.module';
import { RoutesModule } from './routes/routes.module';
import { PaymentsModule } from './payments/payments.module';
import { PayrollModule } from './payroll/payroll.module';
import { AiModule } from './ai/ai.module';
import { AutomationModule } from './automation/automation.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    // Redis-backed in production (shared limits across replicas), in-memory in
    // dev. See ThrottlerConfigService for the store + fail-open behavior.
    ThrottlerModule.forRootAsync({ useClass: ThrottlerConfigService }),
    ScheduleModule.forRoot(),
    PrismaModule,
    DatabaseModule,
    TenantModule,
    MessagingModule,

    AuthModule,
    ConfigModule,
    ServicesModule,
    QuotesModule,
    UploadsModule,
    PlatformModule,
    MeModule,
    AutomationsModule,
    TeamModule,
    TimeModule,
    RoutesModule,
    PaymentsModule,
    PayrollModule,
    AiModule,
    AutomationModule,
    AppointmentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'health',  method: RequestMethod.GET },
        { path: 'version', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
