import { ApiProperty } from '@nestjs/swagger';

export class BulkBooksDto {
  @ApiProperty({ type: [String] })
  bookIds: string[];
}

export class BulkStatusDto extends BulkBooksDto {
  @ApiProperty()
  status: string;
}

export class BulkReadingProgressDto extends BulkBooksDto {
  @ApiProperty({ enum: ['mark-read', 'mark-unread'] })
  action: 'mark-read' | 'mark-unread';
}
