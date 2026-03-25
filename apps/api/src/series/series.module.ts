import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SeriesService } from './series.service';
import { SeriesController } from './series.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SeriesController],
  providers: [SeriesService],
})
export class SeriesModule {}
