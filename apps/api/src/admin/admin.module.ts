import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';
import { BooksModule } from '../books/books.module';
import { LibraryModule } from '../library/library.module';
import { SeriesModule } from '../series/series.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { FoldersController } from './folders/folders.controller';
import { FoldersService } from './folders/folders.service';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    MetadataModule,
    DiskWriteGuardModule,
    BooksModule,
    LibraryModule,
    SeriesModule,
  ],
  controllers: [AdminController, FoldersController],
  providers: [AdminService, FoldersService],
})
export class AdminModule {}
