import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BookMetadataFields } from '@litara/book-types';

export class PendingBookDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'COLLISION'] })
  status: string;

  @ApiProperty()
  stagedFilePath: string;

  @ApiProperty()
  fileHash: string;

  @ApiProperty()
  originalFilename: string;

  @ApiPropertyOptional()
  title: string | null;

  @ApiPropertyOptional()
  subtitle: string | null;

  @ApiProperty({ description: 'JSON-encoded string[]' })
  authors: string;

  @ApiPropertyOptional()
  seriesName: string | null;

  @ApiPropertyOptional()
  seriesPosition: number | null;

  @ApiPropertyOptional()
  seriesTotalBooks: number | null;

  @ApiPropertyOptional()
  publisher: string | null;

  @ApiPropertyOptional()
  publishedDate: Date | null;

  @ApiPropertyOptional()
  language: string | null;

  @ApiPropertyOptional()
  description: string | null;

  @ApiPropertyOptional()
  isbn10: string | null;

  @ApiPropertyOptional()
  isbn13: string | null;

  @ApiPropertyOptional()
  pageCount: number | null;

  @ApiProperty({ description: 'JSON-encoded string[]' })
  genres: string;

  @ApiProperty({ description: 'JSON-encoded string[]' })
  tags: string;

  @ApiProperty({ description: 'JSON-encoded string[]' })
  moods: string;

  @ApiPropertyOptional()
  googleBooksId: string | null;

  @ApiPropertyOptional()
  openLibraryId: string | null;

  @ApiPropertyOptional()
  goodreadsId: string | null;

  @ApiPropertyOptional()
  asin: string | null;

  @ApiPropertyOptional()
  goodreadsRating: number | null;

  @ApiPropertyOptional()
  coverUrl: string | null;

  @ApiPropertyOptional()
  targetPath: string | null;

  @ApiPropertyOptional()
  collidingPath: string | null;

  @ApiProperty()
  overwriteApproved: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdatePendingBookDto implements BookMetadataFields {
  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  subtitle?: string;

  @ApiPropertyOptional({ type: [String] })
  authors?: string[];

  @ApiPropertyOptional()
  seriesName?: string;

  @ApiPropertyOptional()
  seriesPosition?: number;

  @ApiPropertyOptional()
  seriesTotalBooks?: number;

  @ApiPropertyOptional()
  publisher?: string;

  @ApiPropertyOptional()
  publishedDate?: string;

  @ApiPropertyOptional()
  language?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  isbn10?: string;

  @ApiPropertyOptional()
  isbn13?: string;

  @ApiPropertyOptional()
  pageCount?: number;

  @ApiPropertyOptional({ type: [String] })
  genres?: string[];

  @ApiPropertyOptional({ type: [String] })
  tags?: string[];

  @ApiPropertyOptional({ type: [String] })
  moods?: string[];

  @ApiPropertyOptional()
  googleBooksId?: string;

  @ApiPropertyOptional()
  openLibraryId?: string;

  @ApiPropertyOptional()
  goodreadsId?: string;

  @ApiPropertyOptional()
  asin?: string;

  @ApiPropertyOptional()
  goodreadsRating?: number;

  @ApiPropertyOptional()
  coverUrl?: string;
}
