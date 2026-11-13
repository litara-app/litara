import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateSmartShelfRuleDto } from './smart-shelf-rule.dto';

export class UpdateSmartShelfDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional({ enum: ['AND', 'OR'] })
  logic?: string;

  @ApiPropertyOptional({ type: [CreateSmartShelfRuleDto] })
  rules?: CreateSmartShelfRuleDto[];
}
