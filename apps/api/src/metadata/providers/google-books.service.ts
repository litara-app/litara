import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetadataResult } from '../interfaces/metadata-result.interface';

const BASE_URL = 'https://www.googleapis.com/books/v1/volumes';

interface GoogleBooksVolumeInfo {
  title?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  imageLinks?: { thumbnail?: string };
  industryIdentifiers?: Array<{ type: string; identifier: string }>;
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
    return this.query(`isbn:${isbn}`);
  }

  async searchByTitleAuthor(
    title: string,
    author?: string,
  ): Promise<MetadataResult | null> {
    const q = author
      ? `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`
      : `intitle:${encodeURIComponent(title)}`;
    return this.query(q);
  }

  private async query(q: string): Promise<MetadataResult | null> {
    try {
      let url = `${BASE_URL}?q=${q}`;
      if (this.apiKey) url += `&key=${this.apiKey}`;

      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Google Books API returned ${response.status} for query: ${q}`,
        );
        return null;
      }

      const data = (await response.json()) as GoogleBooksResponse;
      const item = data?.items?.[0];
      if (!item) return null;

      return this.mapVolumeInfo(item);
    } catch (err) {
      this.logger.warn(
        `Google Books request failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private mapVolumeInfo(item: GoogleBooksItem): MetadataResult {
    const v = item.volumeInfo ?? {};
    const result: MetadataResult = {
      googleBooksId: item.id,
      title: v.title,
      authors: v.authors,
      description: v.description,
      publisher: v.publisher,
      coverUrl: v.imageLinks?.thumbnail,
    };

    if (v.publishedDate) {
      const d = new Date(v.publishedDate);
      if (!isNaN(d.getTime())) result.publishedDate = d;
    }

    for (const id of v.industryIdentifiers ?? []) {
      if (id.type === 'ISBN_10') result.isbn10 = id.identifier;
      if (id.type === 'ISBN_13') result.isbn13 = id.identifier;
    }

    return result;
  }
}
