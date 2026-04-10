import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { GoogleBooksService } from './providers/google-books.service';
import { OpenLibraryService } from './providers/open-library.service';
import { GoodreadsService } from './providers/goodreads.service';
import { HardcoverService } from './providers/hardcover.service';
import { MetadataResult } from './interfaces/metadata-result.interface';

export enum MetadataProvider {
  GoogleBooks = 'google-books',
  OpenLibrary = 'open-library',
  Goodreads = 'goodreads',
  Hardcover = 'hardcover',
}

export const PROVIDERS_CONFIG = [
  {
    id: MetadataProvider.GoogleBooks,
    label: 'Google Books',
    requiresApiKey: false,
    envKey: 'GOOGLE_BOOKS_API_KEY' as string | null,
  },
  {
    id: MetadataProvider.OpenLibrary,
    label: 'Open Library',
    requiresApiKey: false,
    envKey: null as string | null,
  },
  {
    id: MetadataProvider.Goodreads,
    label: 'Goodreads',
    requiresApiKey: false,
    envKey: null as string | null,
  },
  {
    id: MetadataProvider.Hardcover,
    label: 'Hardcover',
    requiresApiKey: true,
    envKey: 'HARDCOVER_API_KEY' as string | null,
  },
] as const;

interface EnrichInput {
  title: string;
  authors: string[];
  isbn13?: string;
}

interface FieldConfigItem {
  field: string;
  provider: string;
  enabled: boolean;
}

const FIELD_CONFIG_KEY = 'metadata_field_config';

export const DEFAULT_FIELD_CONFIG: FieldConfigItem[] = [
  { field: 'title', provider: 'open-library', enabled: true },
  { field: 'subtitle', provider: 'open-library', enabled: true },
  { field: 'description', provider: 'goodreads', enabled: true },
  { field: 'authors', provider: 'open-library', enabled: true },
  { field: 'publisher', provider: 'open-library', enabled: true },
  { field: 'publishedDate', provider: 'open-library', enabled: true },
  { field: 'language', provider: 'open-library', enabled: true },
  { field: 'isbn13', provider: 'open-library', enabled: true },
  { field: 'isbn10', provider: 'open-library', enabled: true },
  { field: 'pageCount', provider: 'open-library', enabled: true },
  { field: 'genres', provider: 'goodreads', enabled: true },
  { field: 'tags', provider: 'open-library', enabled: true },
  { field: 'seriesName', provider: 'goodreads', enabled: true },
  { field: 'googleBooksId', provider: 'google-books', enabled: true },
  { field: 'openLibraryId', provider: 'open-library', enabled: true },
  { field: 'goodreadsId', provider: 'goodreads', enabled: true },
  { field: 'goodreadsRating', provider: 'goodreads', enabled: true },
  { field: 'asin', provider: 'open-library', enabled: true },
];

// Canonical provider call order for multi-provider enrichment
const PROVIDER_ORDER: MetadataProvider[] = [
  MetadataProvider.OpenLibrary,
  MetadataProvider.GoogleBooks,
  MetadataProvider.Goodreads,
  MetadataProvider.Hardcover,
];

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly googleBooks: GoogleBooksService,
    private readonly openLibrary: OpenLibraryService,
    private readonly goodreads: GoodreadsService,
    private readonly hardcover: HardcoverService,
  ) {}

  async getProviderStatuses() {
    const settings = await this.prisma.serverSettings.findMany({
      where: { key: { startsWith: 'metadata_provider_' } },
    });
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    return PROVIDERS_CONFIG.map((p) => {
      const apiKeyConfigured = p.envKey
        ? !!this.config.get<string>(p.envKey)
        : false;
      const available = !p.requiresApiKey || apiKeyConfigured;
      const enabledKey = `metadata_provider_${p.id}_enabled`;
      const enabled = settingsMap.get(enabledKey) !== 'false';
      return {
        id: p.id as string,
        label: p.label,
        enabled,
        requiresApiKey: p.requiresApiKey,
        apiKeyConfigured,
        available,
      };
    });
  }

  async getEnabledProviders(): Promise<Array<{ id: string; label: string }>> {
    const statuses = await this.getProviderStatuses();
    return statuses
      .filter((p) => p.enabled && p.available)
      .map((p) => ({ id: p.id, label: p.label }));
  }

  async testProvider(
    provider: MetadataProvider,
  ): Promise<{ ok: boolean; message: string }> {
    if (provider === MetadataProvider.Hardcover) {
      return this.hardcover.testConnection();
    }
    return { ok: true, message: 'No API key required' };
  }

  async enrichBook(bookId: string, input: EnrichInput): Promise<void> {
    try {
      const result = await this.fetchBestMetadata(input);
      if (!result) {
        this.logger.debug(`No metadata found for "${input.title}"`);
        return;
      }
      await this.applyResult(bookId, result);
    } catch (err) {
      this.logger.warn(
        `Metadata enrichment failed for "${input.title}": ${(err as Error).message}`,
      );
    }
  }

  async fetchFromProvider(
    provider: MetadataProvider,
    input: EnrichInput,
  ): Promise<MetadataResult | null> {
    const firstAuthor = input.authors[0];
    let result: MetadataResult | null = null;

    if (provider === MetadataProvider.GoogleBooks) {
      result = input.isbn13
        ? await this.googleBooks.searchByIsbn(input.isbn13)
        : await this.googleBooks.searchByTitleAuthor(input.title, firstAuthor);
    } else if (provider === MetadataProvider.Goodreads) {
      result = input.isbn13
        ? await this.goodreads.searchByIsbn(input.isbn13)
        : await this.goodreads.searchByTitleAuthor(input.title, firstAuthor);
    } else if (provider === MetadataProvider.Hardcover) {
      result = input.isbn13
        ? await this.hardcover.searchByIsbn(input.isbn13)
        : await this.hardcover.searchByTitleAuthor(input.title, firstAuthor);
    } else {
      result = input.isbn13
        ? await this.openLibrary.searchByIsbn(input.isbn13)
        : await this.openLibrary.searchByTitleAuthor(input.title, firstAuthor);
    }

    return result;
  }

  async searchFromProvider(
    provider: MetadataProvider,
    input: EnrichInput,
  ): Promise<MetadataResult[]> {
    const firstAuthor = input.authors[0];

    // ISBN search always returns at most one result
    if (input.isbn13) {
      const single = await this.fetchFromProvider(provider, input);
      return single ? [single] : [];
    }

    if (provider === MetadataProvider.GoogleBooks) {
      return this.googleBooks.searchManyByTitleAuthor(input.title, firstAuthor);
    } else if (provider === MetadataProvider.Goodreads) {
      return this.goodreads.searchManyByTitleAuthor(input.title, firstAuthor);
    } else if (provider === MetadataProvider.Hardcover) {
      return this.hardcover.searchManyByTitleAuthor(input.title, firstAuthor);
    } else {
      return this.openLibrary.searchManyByTitleAuthor(input.title, firstAuthor);
    }
  }

  async enrichBookForProvider(
    bookId: string,
    provider: MetadataProvider,
    input: EnrichInput,
  ): Promise<void> {
    const result = await this.fetchFromProvider(provider, input);

    if (!result) {
      this.logger.debug(
        `No metadata found for "${input.title}" via ${provider}`,
      );
      return;
    }

    await this.applyResult(bookId, result);
  }

  private async applyResult(
    bookId: string,
    result: MetadataResult,
  ): Promise<void> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { lockedFields: true },
    });
    const locked = new Set<string>(
      JSON.parse(book?.lockedFields ?? '[]') as string[],
    );

    const update: Record<string, unknown> = {};
    if (result.title && !locked.has('title')) update.title = result.title;
    if (result.subtitle && !locked.has('subtitle'))
      update.subtitle = result.subtitle;
    if (result.description && !locked.has('description'))
      update.description = result.description;
    if (result.publishedDate && !locked.has('publishedDate'))
      update.publishedDate = result.publishedDate;
    if (result.publisher && !locked.has('publisher'))
      update.publisher = result.publisher;
    if (result.language && !locked.has('language'))
      update.language = result.language;
    if (result.pageCount && !locked.has('pageCount'))
      update.pageCount = result.pageCount;
    if (result.googleBooksId) update.googleBooksId = result.googleBooksId;
    if (result.openLibraryId) update.openLibraryId = result.openLibraryId;
    if (result.goodreadsId) update.goodreadsId = result.goodreadsId;
    if (result.asin) update.asin = result.asin;
    if (result.goodreadsRating != null)
      update.goodreadsRating = result.goodreadsRating;

    if (!locked.has('isbn13')) {
      if (result.isbn13) {
        update.isbn13 = result.isbn13;
        update.isbn10 = result.isbn10 ?? null;
      }
    }
    if (!locked.has('isbn10') && result.isbn10 && !result.isbn13) {
      update.isbn10 = result.isbn10;
    }

    if (Object.keys(update).length > 0) {
      await this.prisma.book.update({ where: { id: bookId }, data: update });
    }

    if (result.authors?.length && !locked.has('authors')) {
      await this.upsertAuthors(bookId, result.authors);
    }
    if (result.categories?.length && !locked.has('tags')) {
      await this.upsertTags(bookId, result.categories);
    }
    if (result.genres?.length && !locked.has('genres')) {
      await this.upsertGenres(bookId, result.genres);
    }
    if (result.moods?.length && !locked.has('moods')) {
      await this.upsertMoods(bookId, result.moods);
    }

    // Series info from provider
    if (result.seriesName && !locked.has('seriesName')) {
      await this.upsertSeries(
        bookId,
        result.seriesName,
        result.seriesPosition,
        result.seriesTotalBooks,
      );
    }

    this.logger.log(
      `Metadata applied for bookId=${bookId} (goodreadsId=${result.goodreadsId ?? 'n/a'}, googleBooksId=${result.googleBooksId ?? 'n/a'}, openLibraryId=${result.openLibraryId ?? 'n/a'})`,
    );
  }

  async fetchBestMetadata(input: {
    title: string;
    authors: string[];
    isbn13?: string | null;
  }): Promise<MetadataResult | null> {
    const fieldConfig = await this.getFieldConfig();

    // Which providers are needed, and which fields each one owns
    const providerFields = new Map<MetadataProvider, string[]>();
    for (const fc of fieldConfig.filter((f) => f.enabled)) {
      const provider = fc.provider as MetadataProvider;
      providerFields.set(provider, [
        ...(providerFields.get(provider) ?? []),
        fc.field,
      ]);
    }

    if (providerFields.size === 0) return null;

    const orderedProviders = PROVIDER_ORDER.filter((p) =>
      providerFields.has(p),
    );

    // The provider responsible for isbn13 — its result chains the ISBN to later providers
    const isbn13Provider = fieldConfig.find(
      (f) => f.field === 'isbn13' && f.enabled,
    )?.provider as MetadataProvider | undefined;

    let resolvedIsbn13 = input.isbn13 ?? undefined;
    const providerResults = new Map<MetadataProvider, MetadataResult>();

    for (const provider of orderedProviders) {
      const result = await this.fetchFromProviderWithFallback(provider, {
        title: input.title,
        authors: input.authors,
        isbn13: resolvedIsbn13,
      });
      if (result) {
        providerResults.set(provider, result);
        // Chain ISBN from the configured isbn13 provider to all subsequent calls
        if (!resolvedIsbn13 && result.isbn13 && provider === isbn13Provider) {
          resolvedIsbn13 = result.isbn13;
        }
      }
    }

    if (providerResults.size === 0) return null;

    return this.mergeProviderResults(fieldConfig, providerResults);
  }

  private async getFieldConfig(): Promise<FieldConfigItem[]> {
    const row = await this.prisma.serverSettings.findUnique({
      where: { key: FIELD_CONFIG_KEY },
    });
    if (!row) return DEFAULT_FIELD_CONFIG;
    return JSON.parse(row.value) as FieldConfigItem[];
  }

  private async fetchFromProviderWithFallback(
    provider: MetadataProvider,
    input: EnrichInput,
  ): Promise<MetadataResult | null> {
    let result = await this.fetchFromProvider(provider, input);
    // If title+author search returned nothing, retry with title only
    if (!result && !input.isbn13 && input.authors.length > 0) {
      result = await this.fetchFromProvider(provider, {
        ...input,
        authors: [],
      });
    }
    return result;
  }

  private mergeProviderResults(
    fieldConfig: FieldConfigItem[],
    providerResults: Map<MetadataProvider, MetadataResult>,
  ): MetadataResult {
    const merged: MetadataResult = {};
    for (const fc of fieldConfig.filter((f) => f.enabled)) {
      const provider = fc.provider as MetadataProvider;
      const result = providerResults.get(provider);
      if (!result) continue;

      // 'tags' in config maps to 'categories' in MetadataResult
      if (fc.field === 'tags') {
        if (result.categories?.length) merged.categories = result.categories;
        continue;
      }

      const key = fc.field as keyof MetadataResult;
      const value = result[key];
      if (value !== null && value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  }

  // Public surface for BulkMetadataService — delegates to private helpers
  async upsertBookAuthors(
    bookId: string,
    authors: string[],
    locked: Set<string>,
  ): Promise<void> {
    if (!locked.has('authors')) {
      await this.upsertAuthors(bookId, authors);
    }
  }

  async upsertBookGenres(
    bookId: string,
    genres: string[],
    locked: Set<string>,
  ): Promise<void> {
    if (!locked.has('genres')) {
      await this.upsertGenres(bookId, genres);
    }
  }

  async upsertBookTags(
    bookId: string,
    tags: string[],
    locked: Set<string>,
  ): Promise<void> {
    if (!locked.has('tags')) {
      await this.upsertTags(bookId, tags);
    }
  }

  async upsertBookSeries(
    bookId: string,
    seriesName: string,
    position?: number,
    totalBooks?: number,
    locked?: Set<string>,
  ): Promise<void> {
    if (!locked?.has('seriesName')) {
      await this.upsertSeries(bookId, seriesName, position, totalBooks);
    }
  }

  private async upsertAuthors(
    bookId: string,
    authors: string[],
  ): Promise<void> {
    for (const name of authors) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      try {
        const author = await this.prisma.author.upsert({
          where: { name: trimmed },
          update: {},
          create: { name: trimmed },
        });
        await this.prisma.bookAuthor.upsert({
          where: { bookId_authorId: { bookId, authorId: author.id } },
          update: {},
          create: { bookId, authorId: author.id },
        });
      } catch (err) {
        this.logger.warn(
          `Could not upsert author "${trimmed}": ${(err as Error).message}`,
        );
      }
    }
  }

  private async upsertTags(bookId: string, names: string[]): Promise<void> {
    const records: Array<{ id: string }> = [];
    for (const name of names) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      try {
        const tag = await this.prisma.tag.upsert({
          where: { name: trimmed },
          update: {},
          create: { name: trimmed },
        });
        records.push({ id: tag.id });
      } catch (err) {
        this.logger.warn(
          `Could not upsert tag "${trimmed}": ${(err as Error).message}`,
        );
      }
    }
    if (records.length > 0) {
      await this.prisma.book.update({
        where: { id: bookId },
        data: { tags: { connect: records } },
      });
    }
  }

  private async upsertGenres(bookId: string, names: string[]): Promise<void> {
    const records: Array<{ id: string }> = [];
    for (const name of names) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      try {
        const genre = await this.prisma.genre.upsert({
          where: { name: trimmed },
          update: {},
          create: { name: trimmed },
        });
        records.push({ id: genre.id });
      } catch (err) {
        this.logger.warn(
          `Could not upsert genre "${trimmed}": ${(err as Error).message}`,
        );
      }
    }
    if (records.length > 0) {
      await this.prisma.book.update({
        where: { id: bookId },
        data: { genres: { connect: records } },
      });
    }
  }

  private async upsertMoods(bookId: string, names: string[]): Promise<void> {
    const records: Array<{ id: string }> = [];
    for (const name of names) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      try {
        const mood = await this.prisma.mood.upsert({
          where: { name: trimmed },
          update: {},
          create: { name: trimmed },
        });
        records.push({ id: mood.id });
      } catch (err) {
        this.logger.warn(
          `Could not upsert mood "${trimmed}": ${(err as Error).message}`,
        );
      }
    }
    if (records.length > 0) {
      await this.prisma.book.update({
        where: { id: bookId },
        data: { moods: { connect: records } },
      });
    }
  }

  private async upsertSeries(
    bookId: string,
    seriesName: string,
    position?: number,
    totalBooks?: number,
  ): Promise<void> {
    try {
      const series = await this.prisma.series.upsert({
        where: { name: seriesName },
        update: totalBooks != null ? { totalBooks } : {},
        create: { name: seriesName, totalBooks: totalBooks ?? null },
      });
      await this.prisma.seriesBook.upsert({
        where: { seriesId_bookId: { seriesId: series.id, bookId } },
        update: position != null ? { sequence: position } : {},
        create: { seriesId: series.id, bookId, sequence: position ?? null },
      });
    } catch (err) {
      this.logger.warn(
        `Could not upsert series "${seriesName}": ${(err as Error).message}`,
      );
    }
  }
}
