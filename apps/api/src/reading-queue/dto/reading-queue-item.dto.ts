import { ApiProperty } from '@nestjs/swagger';

export class ReadingQueueItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookId: string;

  @ApiProperty()
  position: number;

  @ApiProperty()
  addedAt: Date;

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
