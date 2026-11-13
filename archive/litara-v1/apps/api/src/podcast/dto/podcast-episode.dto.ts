import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EpisodeDownloadStatus } from '@prisma/client';

export class PodcastEpisodeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  podcastId: string;

  @ApiProperty()
  guid: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiPropertyOptional()
  publishedAt: string | null;

  @ApiPropertyOptional()
  duration: number | null;

  @ApiProperty()
  audioUrl: string;

  @ApiProperty({ enum: EpisodeDownloadStatus })
  downloadStatus: EpisodeDownloadStatus;

  @ApiPropertyOptional()
  downloadPath: string | null;

  @ApiPropertyOptional()
  fileSize: string | null;

  @ApiPropertyOptional()
  currentTime: number | null;

  @ApiProperty()
  createdAt: string;
}
