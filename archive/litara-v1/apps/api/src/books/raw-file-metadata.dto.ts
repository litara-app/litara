import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RawFileMetadataDto {
  @ApiProperty()
  format: string;

  @ApiProperty({ required: false })
  title?: string;

  @ApiProperty({ type: [String], required: false })
  authors?: string[];

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  publishedDate?: string;

  @ApiProperty({ required: false })
  publisher?: string;

  @ApiProperty({ required: false })
  language?: string;

  @ApiProperty({ type: [String], required: false })
  subjects?: string[];

  @ApiPropertyOptional({
    additionalProperties: { type: 'string' },
    example: {
      isbn: '9781447273318',
      amazon: 'B00UBL1ETE',
      google: 'P3XCBgAAQBAJ',
      'mobi-asin': 'B00SN93AHU',
    },
  })
  ids?: Record<string, string>;

  // EPUB-specific fields
  @ApiProperty({ required: false })
  contributor?: string;

  @ApiProperty({ required: false })
  rights?: string;

  @ApiProperty({ required: false })
  source?: string;

  @ApiProperty({ required: false })
  coverage?: string;

  @ApiProperty({ required: false })
  relation?: string;

  @ApiProperty({ required: false })
  type?: string;
}
