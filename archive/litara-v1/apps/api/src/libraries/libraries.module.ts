import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { LibraryModule } from '../library/library.module';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';

@Module({
  imports: [DatabaseModule, ConfigModule, forwardRef(() => LibraryModule)],
  controllers: [LibrariesController],
  providers: [LibrariesService],
  exports: [LibrariesService],
})
export class LibrariesModule {}
