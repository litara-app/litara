import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SmartShelvesService } from './smart-shelves.service';
import { SmartShelvesController } from './smart-shelves.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SmartShelvesController],
  providers: [SmartShelvesService],
})
export class SmartShelvesModule {}
