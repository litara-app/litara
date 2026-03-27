import { ApiProperty } from '@nestjs/swagger';

export const ALLOWED_FIELDS = [
  'title',
  'author',
  'genre',
  'tag',
  'language',
  'publisher',
  'seriesName',
  'format',
  'pageCount',
  'publishedYear',
  'isbn13',
  'userRating',
] as const;

export const ALLOWED_OPERATORS = [
  'eq',
  'ne',
  'contains',
  'startsWith',
  'gt',
  'lt',
] as const;

export type AllowedField = (typeof ALLOWED_FIELDS)[number];
export type AllowedOperator = (typeof ALLOWED_OPERATORS)[number];

export class CreateSmartShelfRuleDto {
  @ApiProperty({ enum: ALLOWED_FIELDS })
  field: string;

  @ApiProperty({ enum: ALLOWED_OPERATORS })
  operator: string;

  @ApiProperty()
  value: string;
}

export class SmartShelfRuleDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ALLOWED_FIELDS })
  field: string;

  @ApiProperty({ enum: ALLOWED_OPERATORS })
  operator: string;

  @ApiProperty()
  value: string;
}
