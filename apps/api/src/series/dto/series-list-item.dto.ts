import { ApiProperty } from '@nestjs/swagger';

export class SeriesListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  ownedCount: number;

  @ApiProperty({ nullable: true, required: false })
  totalBooks: number | null;

  @ApiProperty({ type: [String] })
  coverBookIds: string[];

  @ApiProperty({ type: [String] })
  authors: string[];
}
