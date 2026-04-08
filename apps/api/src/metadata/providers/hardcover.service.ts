import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MetadataResult } from '../interfaces/metadata-result.interface';

const GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';

// ── GraphQL response shapes ───────────────────────────────────────────────────

interface HcAuthor {
  name: string;
}

interface HcContribution {
  author: HcAuthor;
}

interface HcSeries {
  name: string;
  books_count: number | null;
}

interface HcBookSeries {
  series: HcSeries;
  position: number | null;
}

// cached_image is a JSONB scalar — returned as a plain object, no subselection
interface HcCachedImage {
  url?: string;
}

interface HcEdition {
  id: number;
  title: string | null;
  description: string | null;
  contributions: HcContribution[];
  pages: number | null;
  release_date: string | null;
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: { name: string } | null;
  language: { language: string } | null;
  users_count: number;
  cached_image: HcCachedImage | null;
  book: {
    description: string | null;
    book_series: HcBookSeries[];
  } | null;
}

interface HcEditionsResponse {
  data?: { editions?: HcEdition[] };
  errors?: Array<{ message: string }>;
}

// ── Shared edition fragment ───────────────────────────────────────────────────

const EDITION_FIELDS = `
  id
  title
  contributions {
    author { name }
  }
  pages
  release_date
  isbn_10
  isbn_13
  publisher { name }
  language { language }
  users_count
  cached_image
  book {
    description
    book_series {
      series { name books_count }
      position
    }
  }
`;

const SEARCH_BY_ISBN_QUERY = `
  query SearchByISBN($isbn: String!) {
    editions(where: { isbn_13: { _eq: $isbn } }, limit: 1) {
      ${EDITION_FIELDS}
    }
  }
`;

const SEARCH_BY_TITLE_AUTHOR_QUERY = `
  query SearchByTitleAuthor($title: String!, $author: String!, $limit: Int!) {
    editions(
      where: {
        _and: [
          { title: { _eq: $title } }
          { contributions: { author: { name: { _eq: $author } } } }
        ]
      }
      limit: $limit
      order_by: { users_count: desc }
    ) {
      ${EDITION_FIELDS}
    }
  }
`;

const SEARCH_BY_TITLE_QUERY = `
  query SearchByTitle($title: String!, $limit: Int!) {
    editions(
      where: { title: { _eq: $title } }
      limit: $limit
      order_by: { users_count: desc }
    ) {
      ${EDITION_FIELDS}
    }
  }
`;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class HardcoverService {
  private readonly logger = new Logger(HardcoverService.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('HARDCOVER_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'HARDCOVER_API_KEY is not set — Hardcover metadata will be unavailable',
      );
    }
  }

  async searchByIsbn(isbn: string): Promise<MetadataResult | null> {
    if (!this.apiKey) return null;
    this.logger.debug(`Hardcover: searching by ISBN ${isbn}`);
    const res = await this.query<HcEditionsResponse>(SEARCH_BY_ISBN_QUERY, {
      isbn,
    });
    const edition = res?.data?.editions?.[0];
    if (!edition) {
      this.logger.debug(`Hardcover: no edition found for ISBN ${isbn}`);
      return null;
    }
    return this.mapEdition(edition);
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
    if (!this.apiKey) return [];
    this.logger.debug(
      `Hardcover: searching "${title}"${author ? ` by ${author}` : ''}`,
    );

    let editions: HcEdition[] | undefined;

    if (author) {
      const res = await this.query<HcEditionsResponse>(
        SEARCH_BY_TITLE_AUTHOR_QUERY,
        { title, author, limit: 3 },
      );
      editions = res?.data?.editions;
    }

    if (!editions?.length) {
      const res = await this.query<HcEditionsResponse>(SEARCH_BY_TITLE_QUERY, {
        title,
        limit: 3,
      });
      editions = res?.data?.editions;
    }

    if (!editions?.length) {
      this.logger.debug(`Hardcover: no results for "${title}"`);
      return [];
    }

    this.logger.debug(
      `Hardcover: ${editions.length} edition(s) for "${title}"`,
    );
    return editions.map((e) => this.mapEdition(e));
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) {
      return { ok: false, message: 'HARDCOVER_API_KEY is not configured' };
    }
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query: '{ __typename }' }),
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: `Authentication failed (HTTP ${res.status})`,
        };
      }
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as {
        errors?: Array<{ message: string }>;
      };
      if (json.errors?.length) {
        return { ok: false, message: json.errors[0].message };
      }
      return { ok: true, message: 'Connected successfully' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private mapEdition(edition: HcEdition): MetadataResult {
    const result: MetadataResult = {
      title: edition.title || undefined,
      description:
        edition.description || edition.book?.description || undefined,
      pageCount: edition.pages ?? undefined,
      coverUrl: edition.cached_image?.url || undefined,
      publisher: edition.publisher?.name || undefined,
      language: edition.language?.language || undefined,
      isbn13: edition.isbn_13 || undefined,
      isbn10: edition.isbn_10 || undefined,
    };

    // Published date
    if (edition.release_date) {
      const d = new Date(edition.release_date);
      if (!isNaN(d.getTime()))
        result.publishedDate = d.toISOString().slice(0, 10);
    }

    // Authors
    const authors = edition.contributions
      ?.map((c) => c.author?.name)
      .filter(Boolean) as string[] | undefined;
    if (authors?.length) result.authors = authors;

    // Series — take the first (primary) series entry
    const seriesEntry = edition.book?.book_series?.[0];
    if (seriesEntry?.series?.name) {
      result.seriesName = seriesEntry.series.name;
      if (seriesEntry.position != null)
        result.seriesPosition = seriesEntry.position;
      if (seriesEntry.series.books_count != null)
        result.seriesTotalBooks = seriesEntry.series.books_count;
    }

    this.logger.debug(
      `Hardcover mapped: "${result.title}" authors=[${result.authors?.join(', ')}] series=${result.seriesName ?? 'none'}`,
    );

    return result;
  }

  private async query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T | null> {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query: document, variables }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`Hardcover HTTP ${res.status}: ${body.slice(0, 300)}`);
        return null;
      }

      const json = (await res.json()) as T & {
        errors?: Array<{ message: string }>;
      };

      if (
        'errors' in json &&
        Array.isArray(json.errors) &&
        json.errors.length > 0
      ) {
        this.logger.warn(
          `Hardcover GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
        );
        return null;
      }

      return json;
    } catch (err) {
      this.logger.warn(`Hardcover request failed: ${(err as Error).message}`);
      return null;
    }
  }
}
