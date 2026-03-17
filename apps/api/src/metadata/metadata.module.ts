import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MetadataService } from './metadata.service';
import { GoogleBooksService } from './providers/google-books.service';
import { OpenLibraryService } from './providers/open-library.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  providers: [MetadataService, GoogleBooksService, OpenLibraryService],
  exports: [MetadataService],
})
export class MetadataModule {}
