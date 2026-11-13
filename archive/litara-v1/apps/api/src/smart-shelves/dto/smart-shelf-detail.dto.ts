import { ApiProperty } from '@nestjs/swagger';
import { SmartShelfRuleDto } from './smart-shelf-rule.dto';

export class SmartShelfDetailDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['AND', 'OR'] })
  logic: string;

  @ApiProperty({ type: [SmartShelfRuleDto] })
  rules: SmartShelfRuleDto[];
}
