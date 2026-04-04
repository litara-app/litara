import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MailModule } from '../mail/mail.module';
import { DiskWriteGuardModule } from '../common/disk-write-guard.module';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';

@Module({
  imports: [DatabaseModule, MetadataModule, MailModule, DiskWriteGuardModule],
  controllers: [BooksController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
