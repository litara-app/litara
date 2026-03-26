import { Injectable, Logger } from '@nestjs/common';
import type { MetadataResult } from '../interfaces/metadata-result.interface';

const SEARCH_URL = 'https://openlibrary.org/search.json';
const COVERS_URL = 'https://covers.openlibrary.org/b/id';

const FIELDS = [
  'title',
  'author_name',
  'publisher',
  'key',
  'first_publish_year',
  'isbn',
  'cover_i',
  'number_of_pages_median',
  'subject',
  'language',
  'id_goodreads',
  'id_amazon',
].join(',');

interface OpenLibrarySearchDoc {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  key?: string;
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
  language?: string[];
  id_goodreads?: string[];
  id_amazon?: string[];
}

interface OpenLibrarySearchResponse {
  docs?: OpenLibrarySearchDoc[];
}

@Injectable()
export class OpenLibraryService {
  private readonly logger = new Logger(OpenLibraryService.name);

  async searchByIsbn(isbn: string): Promise<MetadataResult | null> {
    return this.search(`q=${encodeURIComponent(isbn)}`);
  }

  async searchByTitleAuthor(
    title: string,
    author?: string,
  ): Promise<MetadataResult | null> {
    const results = await this.searchManyByTitleAuthor(title, author);
    return results[0] ?? null;
  }

  async searchManyByTitleAuthor(
    title: string,
    author?: string,
  ): Promise<MetadataResult[]> {
    let query = `title=${encodeURIComponent(title)}`;
    if (author) query += `&author=${encodeURIComponent(author)}`;
    return this.searchMany(query, 3);
  }

  private async search(queryString: string): Promise<MetadataResult | null> {
    const results = await this.searchMany(queryString, 1);
    return results[0] ?? null;
  }

  private async searchMany(
    queryString: string,
    limit: number,
  ): Promise<MetadataResult[]> {
    try {
      const url = `${SEARCH_URL}?${queryString}&fields=${FIELDS}&limit=${limit}`;
      this.logger.debug(`Open Library request: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Open Library returned ${response.status} for: ${url}`,
        );
        return [];
      }

      const data = (await response.json()) as OpenLibrarySearchResponse;
      return (data?.docs ?? []).map((doc) => this.mapDoc(doc));
    } catch (err) {
      this.logger.warn(
        `Open Library request failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private mapDoc(doc: OpenLibrarySearchDoc): MetadataResult {
    const result: MetadataResult = {
      title: doc.title,
      authors: doc.author_name,
      publisher: doc.publisher?.[0],
      openLibraryId: doc.key,
      pageCount: doc.number_of_pages_median,
      categories: doc.subject,
    };

    // Language — prefer English; fall back to first entry
    if (doc.language?.length) {
      result.language =
        doc.language.find((l) => l === 'eng') ?? doc.language[0];
    }

    // Published date — use first_publish_year for a clean single value
    if (doc.first_publish_year) {
      result.publishedDate = new Date(`${doc.first_publish_year}-01-01`);
    }

    // ISBNs — scan the flat array for 10- and 13-digit values
    for (const isbn of doc.isbn ?? []) {
      if (isbn.length === 10 && !result.isbn10) result.isbn10 = isbn;
      if (isbn.length === 13 && !result.isbn13) result.isbn13 = isbn;
      if (result.isbn10 && result.isbn13) break;
    }

    // Cover
    if (doc.cover_i) {
      result.coverUrl = `${COVERS_URL}/${doc.cover_i}-L.jpg`;
    }

    // Goodreads ID — pick the first purely numeric entry
    if (doc.id_goodreads?.length) {
      result.goodreadsId =
        doc.id_goodreads.find((id) => /^\d+$/.test(id)) ?? doc.id_goodreads[0];
    }

    // ASIN — prefer entries that look like Amazon ASINs (B0... or 10-char alphanumeric)
    if (doc.id_amazon?.length) {
      result.asin =
        doc.id_amazon.find((id) => /^B0[A-Z0-9]{8}$/.test(id)) ??
        doc.id_amazon[0];
    }

    return result;
  }
}
