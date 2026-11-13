import { ApiProperty } from '@nestjs/swagger';
import { CreateSmartShelfRuleDto } from './smart-shelf-rule.dto';

export class CreateSmartShelfDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['AND', 'OR'], default: 'AND' })
  logic: string;

  @ApiProperty({ type: [CreateSmartShelfRuleDto] })
  rules: CreateSmartShelfRuleDto[];
}
