import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DownloadPolicy, RetentionPolicy } from '@prisma/client';

export class PodcastDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  feedUrl: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiPropertyOptional()
  artworkUrl: string | null;

  @ApiPropertyOptional()
  author: string | null;

  @ApiPropertyOptional()
  websiteUrl: string | null;

  @ApiPropertyOptional()
  lastRefreshedAt: string | null;

  @ApiProperty()
  refreshIntervalMinutes: number;

  @ApiProperty({ enum: DownloadPolicy })
  downloadPolicy: DownloadPolicy;

  @ApiPropertyOptional()
  keepLatestN: number | null;

  @ApiProperty({ enum: RetentionPolicy })
  retentionPolicy: RetentionPolicy;

  @ApiProperty()
  subscribed: boolean;

  @ApiProperty()
  episodeCount: number;

  @ApiProperty()
  createdAt: string;
}
