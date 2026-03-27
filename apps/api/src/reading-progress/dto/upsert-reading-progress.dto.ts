import { ApiProperty } from '@nestjs/swagger';

export class UpsertReadingProgressDto {
  @ApiProperty({
    description:
      'Format-specific location string (EPUB CFI or percentage string)',
  })
  location: string;

  @ApiProperty({
    description: 'Reading progress as a fraction between 0 and 1',
    required: false,
  })
  percentage?: number;
}
