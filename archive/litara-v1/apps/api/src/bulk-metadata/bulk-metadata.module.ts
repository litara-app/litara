import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { BooksModule } from '../books/books.module';
import { BulkMetadataService } from './bulk-metadata.service';
import { BulkMetadataController } from './bulk-metadata.controller';

@Module({
  imports: [DatabaseModule, MetadataModule, BooksModule],
  controllers: [BulkMetadataController],
  providers: [BulkMetadataService],
})
export class BulkMetadataModule {}
