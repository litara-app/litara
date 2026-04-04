import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';
import { BooksModule } from '../books/books.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [DatabaseModule, MetadataModule, DiskWriteGuardModule, BooksModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
