import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AudiobookController } from './audiobook.controller';
import { AudiobookScannerService } from './audiobook-scanner.service';
import { AudiobookMetadataService } from './audiobook-metadata.service';
import { AudiobookProgressService } from './audiobook-progress.service';
import { AudiobookStreamTokenService } from './audiobook-stream-token.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AudiobookController],
  providers: [
    AudiobookScannerService,
    AudiobookMetadataService,
    AudiobookProgressService,
    AudiobookStreamTokenService,
  ],
  exports: [AudiobookScannerService, AudiobookStreamTokenService],
})
export class AudiobookModule {}
