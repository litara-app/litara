/**
 * Canonical definition of all enrichable book metadata fields.
 * Every field is optional — this type represents what can be present
 * in a metadata result or a partial update, not a complete book record.
 *
 * Conventions:
 *   seriesPosition — the series entry number (e.g. 1, 1.5, 2)
 *   asin           — Amazon Standard Identification Number
 *   publishedDate  — ISO 8601 string (honest about JSON serialization)
 */
export interface BookMetadataFields {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publishedDate?: string;
  isbn10?: string;
  isbn13?: string;
  publisher?: string;
  coverUrl?: string;
  language?: string;
  pageCount?: number;

  // Provider IDs
  googleBooksId?: string;
  openLibraryId?: string;
  goodreadsId?: string;
  asin?: string;

  // Community data
  goodreadsRating?: number;

  // Categorisation
  genres?: string[];
  tags?: string[];
  moods?: string[];

  // Series
  seriesName?: string;
  seriesPosition?: number;
  seriesTotalBooks?: number;
}

/**
 * What metadata providers return. Extends BookMetadataFields with
 * `categories` — a raw provider field that maps to `tags` on apply
 * (via MetadataService.applyMetadata / metadataApply.shared.ts).
 */
export interface MetadataResult extends BookMetadataFields {
  categories?: string[];
}
