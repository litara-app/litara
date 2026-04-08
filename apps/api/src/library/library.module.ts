import { Module } from '@nestjs/common';
import { LibraryScannerService } from './library-scanner.service';
import { LibraryWriteService } from './library-write.service';
import { LibraryController } from './library.controller';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';
import { MetadataModule } from '../metadata/metadata.module';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';

@Module({
  imports: [DatabaseModule, ConfigModule, MetadataModule, DiskWriteGuardModule],
  controllers: [LibraryController],
  providers: [LibraryScannerService, LibraryWriteService],
  exports: [LibraryScannerService, LibraryWriteService],
})
export class LibraryModule {}
