// Metadata fields in this DTO overlap with BookMetadataFields from @litara/book-types.
// Keep field names and types in sync with that interface when making changes.
export class UpdateBookDto {
  // User review (not part of BookMetadataFields)
  rating?: number;
  readStatus?: string;
  libraryId?: string;

  // Metadata fields (book table) — mirrors BookMetadataFields
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  language?: string | null;
  pageCount?: number | null;
  ageRating?: string | null;
  lockedFields?: string[];

  // Cover (fetched from URL and stored as coverData)
  coverUrl?: string;
  goodreadsRating?: number;

  // Relational
  authors?: string[];
  tags?: string[];
  genres?: string[];
  moods?: string[];
  seriesName?: string | null;
  seriesPosition?: number | null;
  seriesTotalBooks?: number | null;
}
