import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SmtpConfigDto {
  @ApiProperty()
  host: string;

  @ApiProperty()
  port: number;

  @ApiProperty()
  fromAddress: string;

  @ApiProperty()
  username: string;

  @ApiPropertyOptional({
    description: 'Omit to keep existing password unchanged',
  })
  password?: string;

  @ApiProperty()
  enableAuth: boolean;

  @ApiProperty()
  enableStartTls: boolean;
}

export class SmtpConfigResponseDto {
  @ApiProperty()
  host: string;

  @ApiProperty()
  port: number;

  @ApiProperty()
  fromAddress: string;

  @ApiProperty()
  username: string;

  @ApiProperty({
    description: 'Masked hint showing last 3 chars, e.g. •••••xyz',
  })
  passwordHint: string;

  @ApiProperty()
  enableAuth: boolean;

  @ApiProperty()
  enableStartTls: boolean;
}

export class SmtpTestResultDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional()
  error?: string;
}
