import { Module } from '@nestjs/common';
import { TimeService } from './time.service';
import { TimeController } from './time.controller';

@Module({
  controllers: [TimeController],
  providers:   [TimeService],
  exports:     [TimeService],
})
export class TimeModule {}
