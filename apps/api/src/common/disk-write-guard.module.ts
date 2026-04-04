import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DiskWriteGuardService } from './disk-write-guard.service';

@Module({
  imports: [DatabaseModule],
  providers: [DiskWriteGuardService],
  exports: [DiskWriteGuardService],
})
export class DiskWriteGuardModule {}
