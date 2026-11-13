import { Module } from '@nestjs/common';
import { PodcastController } from './podcast.controller';
import { PodcastService } from './podcast.service';
import { PodcastSchedulerService } from './podcast-scheduler.service';
import { DatabaseModule } from '../database/database.module';
import { AudiobookModule } from '../audiobook/audiobook.module';

@Module({
  imports: [DatabaseModule, AudiobookModule],
  controllers: [PodcastController],
  providers: [PodcastService, PodcastSchedulerService],
  exports: [PodcastService],
})
export class PodcastModule {}
