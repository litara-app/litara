import { ApiProperty } from '@nestjs/swagger';

export class SeriesAuthorItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class SeriesBookItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, required: false })
  sequence: number | null;

  @ApiProperty()
  hasCover: boolean;

  @ApiProperty()
  coverUpdatedAt: string;

  @ApiProperty({ type: [String] })
  formats: string[];

  @ApiProperty({ nullable: true, required: false })
  publishedDate: string | null;

  @ApiProperty({ nullable: true, required: false })
  pageCount: number | null;

  @ApiProperty({ nullable: true, required: false })
  publisher: string | null;
}

export class SeriesDetailDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  totalBooks: number | null;

  @ApiProperty({ type: [SeriesAuthorItemDto] })
  authors: SeriesAuthorItemDto[];

  @ApiProperty({ type: [SeriesBookItemDto] })
  books: SeriesBookItemDto[];
}
