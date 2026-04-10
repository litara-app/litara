import { ApiProperty } from '@nestjs/swagger';

export class BookSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [String] })
  authors: string[];

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty()
  coverUpdatedAt: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [String] })
  formats: string[];

  @ApiProperty()
  hasFileMissing: boolean;

  @ApiProperty({ nullable: true, required: false })
  seriesName: string | null;

  @ApiProperty({ nullable: true, required: false })
  seriesPosition: number | null;

  @ApiProperty({ nullable: true, required: false })
  publishedDate: Date | null;

  @ApiProperty({ nullable: true, required: false })
  readStatus: string | null;

  @ApiProperty({ nullable: true, required: false })
  rating: number | null;

  @ApiProperty({ type: [String] })
  genres: string[];

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ type: [String] })
  moods: string[];

  @ApiProperty({ nullable: true, required: false })
  publisher: string | null;

  @ApiProperty({ nullable: true, required: false })
  pageCount: number | null;

  @ApiProperty({ nullable: true, required: false })
  goodreadsRating: number | null;
}
