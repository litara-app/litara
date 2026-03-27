import { ApiProperty } from '@nestjs/swagger';

export class InProgressBookSummaryDto {
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

  @ApiProperty({ type: [String] })
  formats: string[];

  @ApiProperty()
  hasFileMissing: boolean;
}

export class InProgressBookDto {
  @ApiProperty()
  bookId: string;

  @ApiProperty({ nullable: true })
  percentage: number | null;

  @ApiProperty()
  lastSyncedAt: Date;

  @ApiProperty({ type: InProgressBookSummaryDto })
  book: InProgressBookSummaryDto;
}
