import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ShelvesService } from './shelves.service';
import { ShelvesController } from './shelves.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ShelvesController],
  providers: [ShelvesService],
})
export class ShelvesModule {}
