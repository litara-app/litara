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

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  coverBooks: Array<{ id: string; coverUpdatedAt: string }>;

  @ApiProperty({ type: [String] })
  authors: string[];
}
