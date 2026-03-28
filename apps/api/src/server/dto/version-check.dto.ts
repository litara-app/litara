import { ApiProperty } from '@nestjs/swagger';

export class VersionCheckDto {
  @ApiProperty({ description: 'Version currently running', example: '1.8.0' })
  currentVersion: string;

  @ApiProperty({ description: 'Latest published release', example: '1.9.0' })
  latestVersion: string;

  @ApiProperty()
  updateAvailable: boolean;

  @ApiProperty({
    example: 'https://github.com/litara-app/litara/releases/tag/v1.9.0',
  })
  releaseUrl: string;

  @ApiProperty({
    description: 'Markdown release notes from GitHub release body',
  })
  releaseNotes: string;

  @ApiProperty({ description: 'ISO timestamp when GitHub was last queried' })
  cachedAt: string;
}
