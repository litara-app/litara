import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';
import { BooksModule } from '../books/books.module';
import { LibraryModule } from '../library/library.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    MetadataModule,
    DiskWriteGuardModule,
    BooksModule,
    LibraryModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
