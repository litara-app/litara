import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';
import { MetadataModule } from '../metadata/metadata.module';
import { LibraryWriteService } from '../library/library-write.service';
import { BookDropService } from './book-drop.service';
import { BookDropController } from './book-drop.controller';

@Module({
  imports: [DatabaseModule, ConfigModule, DiskWriteGuardModule, MetadataModule],
  controllers: [BookDropController],
  providers: [BookDropService, LibraryWriteService],
})
export class BookDropModule {}
