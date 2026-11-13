import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { SeriesService } from './series.service';
import { SeriesController } from './series.controller';

@Module({
  imports: [DatabaseModule, MetadataModule],
  controllers: [SeriesController],
  providers: [SeriesService],
  exports: [SeriesService],
})
export class SeriesModule {}
