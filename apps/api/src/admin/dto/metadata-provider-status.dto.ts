import { ApiProperty } from '@nestjs/swagger';

export class MetadataProviderStatusDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  requiresApiKey: boolean;

  @ApiProperty()
  apiKeyConfigured: boolean;

  @ApiProperty()
  available: boolean;
}

export class MetadataProviderTestDto {
  @ApiProperty()
  ok: boolean;

  @ApiProperty()
  message: string;
}
