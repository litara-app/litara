import { ApiProperty } from '@nestjs/swagger';

export class SuccessDto {
  @ApiProperty()
  success: boolean;
}
