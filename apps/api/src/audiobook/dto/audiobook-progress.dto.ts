import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertAudiobookProgressDto {
  @ApiProperty({
    description: 'Index of the current AudiobookFile (zero-based)',
  })
  currentFileIndex: number;

  @ApiProperty({
    description: 'Playback position within the current file, in seconds',
  })
  currentTime: number;

  @ApiProperty({
    description: 'Total duration of all files combined, in seconds',
  })
  totalDuration: number;
}

export class AudiobookProgressResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty()
  currentFileIndex: number;

  @ApiProperty()
  currentTime: number;

  @ApiProperty()
  totalDuration: number;

  @ApiPropertyOptional({ type: String })
  completedAt: Date | null;

  @ApiProperty()
  updatedAt: Date;
}
