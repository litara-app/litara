import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAudiobookBookmarkDto {
  @ApiProperty({
    description: 'Timestamp in seconds within the total audiobook duration',
  })
  timeSeconds: number;

  @ApiPropertyOptional({ description: 'Optional text note for the bookmark' })
  note?: string;
}

export class AudiobookBookmarkResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bookId: string;
  @ApiProperty() timeSeconds: number;
  @ApiProperty() note: string;
  @ApiProperty() createdAt: Date;
}
