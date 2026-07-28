import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { QuotesModule } from '../quotes/quotes.module';

@Module({
  imports:     [QuotesModule],
  controllers: [UploadsController],
  providers:   [UploadsService],
  exports:     [UploadsService],
})
export class UploadsModule {}
