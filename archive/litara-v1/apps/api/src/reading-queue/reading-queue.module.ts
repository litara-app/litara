import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReadingQueueService } from './reading-queue.service';
import { ReadingQueueController } from './reading-queue.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ReadingQueueController],
  providers: [ReadingQueueService],
})
export class ReadingQueueModule {}
