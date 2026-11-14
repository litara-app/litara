import { ApiProperty } from '@nestjs/swagger';
import { ProgressSource } from '@prisma/client';

export class ReadingProgressResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty({ enum: ProgressSource })
  source: ProgressSource;

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
