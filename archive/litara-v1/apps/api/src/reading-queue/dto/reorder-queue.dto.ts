import { ApiProperty } from '@nestjs/swagger';

export class ReorderQueueDto {
  @ApiProperty({ type: [String] })
  bookIds: string[];
}
