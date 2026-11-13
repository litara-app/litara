import { ApiProperty } from '@nestjs/swagger';

export class AddToQueueDto {
  @ApiProperty()
  bookId: string;
}
