import { Module } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { RouteSchedulerService } from './route-scheduler.service';

@Module({
  controllers: [RoutesController],
  providers:   [RoutesService, RouteSchedulerService],
  exports:     [RoutesService],
})
export class RoutesModule {}
