import { ApiProperty } from '@nestjs/swagger';

export class FieldConfigItemDto {
  @ApiProperty({ description: 'Metadata field name' })
  field!: string;

  @ApiProperty({ description: 'Provider id to use for this field' })
  provider!: string;

  @ApiProperty({
    description: 'Whether this field is enabled for bulk enrichment',
  })
  enabled!: boolean;
}

export class UpdateFieldConfigDto {
  @ApiProperty({ type: [FieldConfigItemDto] })
  config!: FieldConfigItemDto[];
}

export class UpdateThrottleDto {
  @ApiProperty({
    description: 'Delay in ms between provider API calls (50–5000)',
    minimum: 50,
    maximum: 5000,
  })
  throttleMs!: number;
}
