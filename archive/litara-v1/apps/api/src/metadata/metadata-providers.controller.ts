import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MetadataService } from './metadata.service';

@ApiBearerAuth()
@Controller('settings/metadata-providers')
@UseGuards(JwtAuthGuard)
export class MetadataProvidersController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get enabled and available metadata providers for the current user',
  })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  })
  getAvailable() {
    return this.metadataService.getEnabledProviders();
  }
}
