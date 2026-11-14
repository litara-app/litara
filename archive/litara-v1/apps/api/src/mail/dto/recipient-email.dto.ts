import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecipientEmailDto {
  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  label?: string;
}

export class RecipientEmailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  label: string | null;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  createdAt: Date;
}
