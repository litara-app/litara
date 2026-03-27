import { ApiProperty } from '@nestjs/swagger';

export class ReadingProgressResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty({
    description:
      'Format-specific location string (EPUB CFI or percentage string)',
  })
  location: string;

  @ApiProperty({ required: false, nullable: true })
  percentage: number | null;

  @ApiProperty()
  lastSyncedAt: Date;
}
