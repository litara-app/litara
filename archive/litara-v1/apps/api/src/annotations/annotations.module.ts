import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AnnotationsService } from './annotations.service';
import {
  AnnotationsController,
  UserAnnotationsController,
} from './annotations.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AnnotationsController, UserAnnotationsController],
  providers: [AnnotationsService],
})
export class AnnotationsModule {}
