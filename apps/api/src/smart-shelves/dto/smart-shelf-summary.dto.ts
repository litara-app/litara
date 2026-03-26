import { ApiProperty } from '@nestjs/swagger';

export class SmartShelfSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['AND', 'OR'] })
  logic: string;

  @ApiProperty()
  ruleCount: number;
}
