import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

export class LibraryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  path: string;

  @ApiPropertyOptional({ nullable: true })
  iconKey: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Sparse {field: providerId} map; null = inherit global config',
  })
  metadataFieldOverrides: Record<string, string> | null;

  @ApiProperty({ type: [String] })
  metadataProvidersDisabled: string[];

  @ApiPropertyOptional({ nullable: true })
  lastScanAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Number of books in this library' })
  bookCount: number;
}

export interface LibraryWithCount {
  id: string;
  name: string;
  path: string;
  iconKey: string | null;
  metadataFieldOverrides: Prisma.JsonValue | null;
  metadataProvidersDisabled: string[];
  lastScanAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bookCount: number;
}

export class DeleteLibraryDto {
  @ApiPropertyOptional({
    description: 'If true, permanently delete all books in the library',
    default: false,
  })
  deleteBooks?: boolean;
}

export class CreateLibraryDto {
  @ApiProperty()
  name: string;

  @ApiProperty({
    description: 'Absolute path; must be under EBOOK_LIBRARY_PATH',
  })
  path: string;

  @ApiPropertyOptional()
  iconKey?: string;

  @ApiPropertyOptional({
    description: 'Sparse {field: providerId} overrides; omit to inherit global',
  })
  metadataFieldOverrides?: Record<string, string>;

  @ApiPropertyOptional({ type: [String] })
  metadataProvidersDisabled?: string[];
}

export class UpdateLibraryDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  iconKey?: string;

  @ApiPropertyOptional({
    description: 'Absolute path; must be under EBOOK_LIBRARY_PATH',
  })
  path?: string;

  @ApiPropertyOptional()
  metadataFieldOverrides?: Record<string, string> | null;

  @ApiPropertyOptional({ type: [String] })
  metadataProvidersDisabled?: string[];
}
