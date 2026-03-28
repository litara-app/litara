import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ServerService } from './server.service';
import { VersionCheckDto } from './dto/version-check.dto';

@ApiTags('server')
@ApiBearerAuth()
@Controller('server')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Get('version-check')
  @ApiOkResponse({ type: VersionCheckDto })
  getVersionCheck(): Promise<VersionCheckDto> {
    return this.serverService.getVersionCheck();
  }
}
