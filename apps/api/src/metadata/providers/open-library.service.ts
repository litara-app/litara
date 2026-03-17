import { Injectable, Logger } from '@nestjs/common';
import { MetadataResult } from '../interfaces/metadata-result.interface';

const SEARCH_URL = 'https://openlibrary.org/search.json';
const BOOKS_URL = 'https://openlibrary.org/api/books';
const COVERS_URL = 'https://covers.openlibrary.org/b/id';

interface OpenLibraryAuthor {
  name?: string;
}

interface OpenLibraryPublisher {
  name?: string;
}

interface OpenLibraryIdentifiers {
  isbn_10?: string[];
  isbn_13?: string[];
}

interface OpenLibraryCover {
  large?: string;
  medium?: string;
  small?: string;
}

interface OpenLibraryBookData {
  title?: string;
  authors?: OpenLibraryAuthor[];
  publishers?: OpenLibraryPublisher[];
  key?: string;
  publish_date?: string;
  identifiers?: OpenLibraryIdentifiers;
  cover?: OpenLibraryCover;
}

interface OpenLibraryBooksResponse {
  [key: string]: OpenLibraryBookData;
}

interface OpenLibrarySearchDoc {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  key?: string;
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
}

interface OpenLibrarySearchResponse {
  docs?: OpenLibrarySearchDoc[];
}

@Injectable()
export class OpenLibraryService {
  private readonly logger = new Logger(OpenLibraryService.name);

  async searchByIsbn(isbn: string): Promise<MetadataResult | null> {
    try {
      const url = `${BOOKS_URL}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Open Library API returned ${response.status} for ISBN: ${isbn}`,
        );
        return null;
      }

      const data = (await response.json()) as OpenLibraryBooksResponse;
      const entry = data[`ISBN:${isbn}`];
      if (!entry) return null;

      return this.mapBookData(entry);
    } catch (err) {
      this.logger.warn(
        `Open Library ISBN request failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async searchByTitleAuthor(
    title: string,
    author?: string,
  ): Promise<MetadataResult | null> {
    try {
      let url = `${SEARCH_URL}?title=${encodeURIComponent(title)}&limit=1`;
      if (author) url += `&author=${encodeURIComponent(author)}`;

      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Open Library search returned ${response.status} for title: ${title}`,
        );
        return null;
      }

      const data = (await response.json()) as OpenLibrarySearchResponse;
      const doc = data?.docs?.[0];
      if (!doc) return null;

      return this.mapSearchDoc(doc);
    } catch (err) {
      this.logger.warn(
        `Open Library search request failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private mapBookData(entry: OpenLibraryBookData): MetadataResult {
    const result: MetadataResult = {
      title: entry.title,
      authors: entry.authors
        ?.map((a) => a.name)
        .filter((n): n is string => Boolean(n)),
      publisher: entry.publishers?.[0]?.name,
      openLibraryId: entry.key,
    };

    if (entry.publish_date) {
      const d = new Date(entry.publish_date);
      if (!isNaN(d.getTime())) result.publishedDate = d;
    }

    const isbns10: string[] = entry.identifiers?.isbn_10 ?? [];
    const isbns13: string[] = entry.identifiers?.isbn_13 ?? [];
    if (isbns10[0]) result.isbn10 = isbns10[0];
    if (isbns13[0]) result.isbn13 = isbns13[0];

    const coverId =
      entry.cover?.large ?? entry.cover?.medium ?? entry.cover?.small;
    if (coverId) {
      result.coverUrl = coverId;
    }

    return result;
  }

  private mapSearchDoc(doc: OpenLibrarySearchDoc): MetadataResult {
    const result: MetadataResult = {
      title: doc.title,
      authors: doc.author_name,
      publisher: doc.publisher?.[0],
      openLibraryId: doc.key,
    };

    if (doc.first_publish_year) {
      result.publishedDate = new Date(`${doc.first_publish_year}-01-01`);
    }

    const isbns: string[] = doc.isbn ?? [];
    for (const isbn of isbns) {
      if (isbn.length === 10 && !result.isbn10) result.isbn10 = isbn;
      if (isbn.length === 13 && !result.isbn13) result.isbn13 = isbn;
    }

    if (doc.cover_i) {
      result.coverUrl = `${COVERS_URL}/${doc.cover_i}-L.jpg`;
    }

    return result;
  }
}
