import { ApiProperty } from '@nestjs/swagger';
import type { BookMetadataFields } from '@litara/book-types';

export class MetadataResultDto implements BookMetadataFields {
  @ApiProperty({ required: false }) title?: string;
  @ApiProperty({ required: false }) subtitle?: string;
  @ApiProperty({ type: [String], required: false }) authors?: string[];
  @ApiProperty({ required: false }) description?: string;
  @ApiProperty({ required: false }) publishedDate?: string;
  @ApiProperty({ required: false }) isbn10?: string;
  @ApiProperty({ required: false }) isbn13?: string;
  @ApiProperty({ required: false }) publisher?: string;
  @ApiProperty({ required: false }) coverUrl?: string;
  @ApiProperty({ required: false }) language?: string;
  @ApiProperty({ required: false }) pageCount?: number;

  // Provider IDs
  @ApiProperty({ required: false }) googleBooksId?: string;
  @ApiProperty({ required: false }) openLibraryId?: string;
  @ApiProperty({ required: false }) goodreadsId?: string;
  @ApiProperty({ required: false }) asin?: string;

  // Community data
  @ApiProperty({ required: false }) goodreadsRating?: number;

  // Categorisation
  @ApiProperty({ type: [String], required: false }) categories?: string[];
  @ApiProperty({ type: [String], required: false }) genres?: string[];
  @ApiProperty({ type: [String], required: false }) tags?: string[];
  @ApiProperty({ type: [String], required: false }) moods?: string[];

  // Series
  @ApiProperty({ required: false }) seriesName?: string;
  @ApiProperty({ required: false }) seriesPosition?: number;
  @ApiProperty({ required: false }) seriesTotalBooks?: number;
}
