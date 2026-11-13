import { ApiProperty } from '@nestjs/swagger';
import { BookSummaryDto } from '../../books/book-summary.dto';

export class SmartShelfBooksResponseDto {
  @ApiProperty()
  total: number;

  @ApiProperty({ type: [BookSummaryDto] })
  books: BookSummaryDto[];
}
