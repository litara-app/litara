import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MailModule } from '../mail/mail.module';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';

@Module({
  imports: [DatabaseModule, MetadataModule, MailModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
