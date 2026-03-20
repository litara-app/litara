export interface MetadataResult {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publishedDate?: Date;
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

  // Goodreads community data
  goodreadsRating?: number;

  // Categorisation — genres come from providers, tags/moods are user-defined
  categories?: string[]; // maps to tags on apply
  genres?: string[];
  moods?: string[];

  // Series
  seriesName?: string;
  seriesPosition?: number;
  seriesTotalBooks?: number;
}
