import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MetadataService } from './metadata.service';
import { MetadataProvidersController } from './metadata-providers.controller';
import { GoogleBooksService } from './providers/google-books.service';
import { OpenLibraryService } from './providers/open-library.service';
import { GoodreadsService } from './providers/goodreads.service';
import { HardcoverService } from './providers/hardcover.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [MetadataProvidersController],
  providers: [
    MetadataService,
    GoogleBooksService,
    OpenLibraryService,
    GoodreadsService,
    HardcoverService,
  ],
  exports: [MetadataService, OpenLibraryService],
})
export class MetadataModule {}
