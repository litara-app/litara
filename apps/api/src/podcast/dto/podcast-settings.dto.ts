import { ApiProperty } from '@nestjs/swagger';

export class PodcastSettingsDto {
  @ApiProperty()
  enabled: boolean;
}
