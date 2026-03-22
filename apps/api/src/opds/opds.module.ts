import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../database/database.module';
import { OpdsService } from './opds.service';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsV1Controller } from './opds-v1.controller';
import { OpdsV2Controller } from './opds-v2.controller';
import { BasicAuthStrategy } from './auth/basic-auth.strategy';
import { BasicAuthGuard } from './auth/basic-auth.guard';

@Module({
  imports: [DatabaseModule, PassportModule],
  controllers: [OpdsV1Controller, OpdsV2Controller],
  providers: [OpdsService, BasicAuthStrategy, BasicAuthGuard, OpdsEnabledGuard],
})
export class OpdsModule {}
