import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GuidedSelectionDto {
  @ApiProperty()
  bookId!: string;

  @ApiProperty({ description: 'OpenLibrary work key, e.g. /works/OL123W' })
  openLibraryKey!: string;

  @ApiPropertyOptional({
    description:
      'ISBN-13 from the selected candidate, used as hint for chained providers',
  })
  isbn13?: string;
}

export class RunBulkMatchDto {
  @ApiProperty({ enum: ['all', 'library', 'shelf'] })
  scope!: 'all' | 'library' | 'shelf';

  @ApiPropertyOptional({
    description: 'Library or shelf ID when scope is not "all"',
  })
  scopeId?: string;

  @ApiPropertyOptional({
    description:
      'Replace existing field values (default: false — fill blanks only)',
  })
  overwrite?: boolean;

  @ApiPropertyOptional({ type: [GuidedSelectionDto] })
  guidedSelections?: GuidedSelectionDto[];

  @ApiPropertyOptional({
    description: 'Override throttle delay for this run (ms)',
  })
  throttleMs?: number;
}

export class CandidatesRequestDto {
  @ApiProperty()
  bookId!: string;

  @ApiPropertyOptional({
    description: 'Max candidates to return (1–3, default 3)',
  })
  limit?: number;
}

export class CandidateDto {
  @ApiProperty()
  openLibraryKey!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [String] })
  authors!: string[];

  @ApiPropertyOptional()
  year?: number;

  @ApiPropertyOptional()
  coverUrl?: string;

  @ApiPropertyOptional()
  isbn13?: string;
}
