import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReadingProgressService } from './reading-progress.service';
import { ReadingProgressController } from './reading-progress.controller';
import { UserReadingProgressController } from './user-reading-progress.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ReadingProgressController, UserReadingProgressController],
  providers: [ReadingProgressService],
})
export class ReadingProgressModule {}
