import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { KoReaderSyncController } from './koreader-sync.controller';
import { KoReaderSyncService } from './koreader-sync.service';
import { KoReaderAuthGuard } from './koreader-auth.guard';
import { KoReaderEnabledGuard } from './koreader-enabled.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [KoReaderSyncController],
  providers: [KoReaderSyncService, KoReaderAuthGuard, KoReaderEnabledGuard],
})
export class KoReaderSyncModule {}
