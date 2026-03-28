import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [DatabaseModule, MetadataModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
