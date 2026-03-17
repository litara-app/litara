import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
