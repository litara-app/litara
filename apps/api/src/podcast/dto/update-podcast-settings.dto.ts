import { ApiPropertyOptional } from '@nestjs/swagger';
import { DownloadPolicy, RetentionPolicy } from '@prisma/client';

export class UpdatePodcastSettingsDto {
  @ApiPropertyOptional({ minimum: 15, maximum: 10080 })
  refreshIntervalMinutes?: number;

  @ApiPropertyOptional({ enum: DownloadPolicy })
  downloadPolicy?: DownloadPolicy;

  @ApiPropertyOptional()
  keepLatestN?: number;

  @ApiPropertyOptional({ enum: RetentionPolicy })
  retentionPolicy?: RetentionPolicy;
}
