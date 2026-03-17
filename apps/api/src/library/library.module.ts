import { Module } from '@nestjs/common';
import { LibraryScannerService } from './library-scanner.service';
import { LibraryController } from './library.controller';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';
import { MetadataModule } from '../metadata/metadata.module';

@Module({
  imports: [DatabaseModule, ConfigModule, MetadataModule],
  controllers: [LibraryController],
  providers: [LibraryScannerService],
  exports: [LibraryScannerService],
})
export class LibraryModule {}
