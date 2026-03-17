import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [LibrariesController],
  providers: [LibrariesService],
})
export class LibrariesModule {}
