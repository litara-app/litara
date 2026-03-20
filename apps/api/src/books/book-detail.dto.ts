import { ApiProperty } from '@nestjs/swagger';

export class BookFileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  format: string;

  @ApiProperty()
  sizeBytes: string;

  @ApiProperty()
  filePath: string;

  @ApiProperty({ nullable: true })
  missingAt: Date | null;
}

export class UserReviewDto {
  @ApiProperty({ nullable: true })
  rating: number | null;

  @ApiProperty()
  readStatus: string;
}

export class BookSeriesDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  sequence: number | null;

  @ApiProperty({ nullable: true })
  totalBooks: number | null;
}

export class LibraryRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class ShelfRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class BookDetailDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  subtitle: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  isbn13: string | null;

  @ApiProperty({ nullable: true })
  publisher: string | null;

  @ApiProperty({ nullable: true })
  publishedDate: Date | null;

  @ApiProperty({ nullable: true })
  language: string | null;

  @ApiProperty({ nullable: true })
  pageCount: number | null;

  @ApiProperty({ nullable: true })
  ageRating: string | null;

  @ApiProperty({ type: [String] })
  lockedFields: string[];

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty({ nullable: true, type: () => LibraryRefDto })
  library: LibraryRefDto | null;

  @ApiProperty({ type: [String] })
  authors: string[];

  @ApiProperty({ nullable: true })
  isbn10: string | null;

  @ApiProperty({ nullable: true })
  goodreadsId: string | null;

  @ApiProperty({ nullable: true })
  goodreadsRating: number | null;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ type: [String] })
  genres: string[];

  @ApiProperty({ type: [String] })
  moods: string[];

  @ApiProperty({ nullable: true, type: () => BookSeriesDto })
  series: BookSeriesDto | null;

  @ApiProperty({ type: [BookFileDto] })
  files: BookFileDto[];

  @ApiProperty({ type: () => UserReviewDto })
  userReview: UserReviewDto;

  @ApiProperty({ type: [ShelfRefDto] })
  shelves: ShelfRefDto[];

  @ApiProperty({ nullable: true })
  sidecarFile: string | null;
}
