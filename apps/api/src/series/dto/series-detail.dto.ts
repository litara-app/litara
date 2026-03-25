import { ApiProperty } from '@nestjs/swagger';

export class SeriesBookItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, required: false })
  sequence: number | null;

  @ApiProperty()
  hasCover: boolean;

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

  @ApiProperty({ type: [String] })
  authors: string[];

  @ApiProperty({ type: [SeriesBookItemDto] })
  books: SeriesBookItemDto[];
}
