import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetadataResult } from '../interfaces/metadata-result.interface';

const BASE_URL = 'https://www.googleapis.com/books/v1/volumes';

interface GoogleBooksVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  imageLinks?: { thumbnail?: string };
  industryIdentifiers?: Array<{ type: string; identifier: string }>;
  language?: string;
  pageCount?: number;
  categories?: string[];
}

interface GoogleBooksItem {
  id?: string;
  volumeInfo?: GoogleBooksVolumeInfo;
}

interface GoogleBooksResponse {
  items?: GoogleBooksItem[];
}

@Injectable()
export class GoogleBooksService {
  private readonly logger = new Logger(GoogleBooksService.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GOOGLE_BOOKS_API_KEY');
  }

  async searchByIsbn(isbn: string): Promise<MetadataResult | null> {
    this.logger.debug(`Searching Google Books for ISBN: ${isbn}`);
    return this.query(`isbn:${isbn}`);
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
    const q = author
      ? `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`
      : `intitle:${encodeURIComponent(title)}`;
    return this.queryMany(q, 3);
  }

  private async query(q: string): Promise<MetadataResult | null> {
    const results = await this.queryMany(q, 1);
    return results[0] ?? null;
  }

  private async queryMany(
    q: string,
    maxResults: number,
  ): Promise<MetadataResult[]> {
    try {
      let url = `${BASE_URL}?q=${q}&maxResults=${maxResults}`;
      if (this.apiKey) url += `&key=${this.apiKey}`;
      this.logger.debug(`Querying Google Books API: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Google Books API returned ${response.status} for query: ${q}`,
        );
        return [];
      }

      const data = (await response.json()) as GoogleBooksResponse;
      return (data?.items ?? []).map((item) => this.mapVolumeInfo(item));
    } catch (err) {
      this.logger.warn(
        `Google Books request failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private mapVolumeInfo(item: GoogleBooksItem): MetadataResult {
    const v = item.volumeInfo ?? {};
    const result: MetadataResult = {
      googleBooksId: item.id,
      title: v.title,
      subtitle: v.subtitle,
      authors: v.authors,
      description: v.description,
      publisher: v.publisher,
      coverUrl: v.imageLinks?.thumbnail,
      language: v.language,
      pageCount: v.pageCount,
      categories: v.categories,
    };

    if (v.publishedDate) {
      const d = new Date(v.publishedDate);
      if (!isNaN(d.getTime()))
        result.publishedDate = d.toISOString().slice(0, 10);
    }

    for (const id of v.industryIdentifiers ?? []) {
      if (id.type === 'ISBN_10') result.isbn10 = id.identifier;
      if (id.type === 'ISBN_13') result.isbn13 = id.identifier;
    }

    return result;
  }
}
