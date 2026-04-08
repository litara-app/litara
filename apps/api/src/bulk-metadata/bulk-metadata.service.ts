import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  MetadataService,
  MetadataProvider,
} from '../metadata/metadata.service';
import { OpenLibraryService } from '../metadata/providers/open-library.service';
import { BooksService } from '../books/books.service';
import type { MetadataResult } from '../metadata/interfaces/metadata-result.interface';
import type { FieldConfigItemDto, GuidedSelectionDto } from './dto';

export const DEFAULT_FIELD_CONFIG: FieldConfigItemDto[] = [
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

const FIELD_CONFIG_KEY = 'metadata_field_config';
const THROTTLE_KEY = 'metadata_match_throttle_ms';
const AUTO_WRITE_KEY = 'auto_write_metadata_on_enrich';
const DEFAULT_THROTTLE = 500;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

@Injectable()
export class BulkMetadataService {
  private readonly logger = new Logger(BulkMetadataService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly metadataService: MetadataService,
    private readonly openLibrary: OpenLibraryService,
    private readonly booksService: BooksService,
  ) {}

  // ── Config ────────────────────────────────────────────────────────────────

  async getFieldConfig(): Promise<FieldConfigItemDto[]> {
    const row = await this.prisma.serverSettings.findUnique({
      where: { key: FIELD_CONFIG_KEY },
    });
    if (!row) return DEFAULT_FIELD_CONFIG;
    return JSON.parse(row.value) as FieldConfigItemDto[];
  }

  async saveFieldConfig(
    config: FieldConfigItemDto[],
  ): Promise<FieldConfigItemDto[]> {
    await this.prisma.serverSettings.upsert({
      where: { key: FIELD_CONFIG_KEY },
      update: { value: JSON.stringify(config) },
      create: { key: FIELD_CONFIG_KEY, value: JSON.stringify(config) },
    });
    return config;
  }

  async getThrottle(): Promise<number> {
    const row = await this.prisma.serverSettings.findUnique({
      where: { key: THROTTLE_KEY },
    });
    if (!row) return DEFAULT_THROTTLE;
    return parseInt(row.value, 10) || DEFAULT_THROTTLE;
  }

  async saveThrottle(throttleMs: number): Promise<number> {
    const clamped = Math.max(50, Math.min(5000, throttleMs));
    await this.prisma.serverSettings.upsert({
      where: { key: THROTTLE_KEY },
      update: { value: String(clamped) },
      create: { key: THROTTLE_KEY, value: String(clamped) },
    });
    return clamped;
  }

  async getAutoWriteOnEnrich(): Promise<boolean> {
    const row = await this.prisma.serverSettings.findUnique({
      where: { key: AUTO_WRITE_KEY },
    });
    return row?.value === 'true';
  }

  async setAutoWriteOnEnrich(enabled: boolean): Promise<boolean> {
    await this.prisma.serverSettings.upsert({
      where: { key: AUTO_WRITE_KEY },
      update: { value: String(enabled) },
      create: { key: AUTO_WRITE_KEY, value: String(enabled) },
    });
    return enabled;
  }

  // ── Candidates ────────────────────────────────────────────────────────────

  async getCandidates(bookId: string, limit: number) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: { authors: { include: { author: true } } },
    });
    if (!book) throw new NotFoundException('Book not found');

    const results = await this.openLibrary.searchManyByTitleAuthor(
      book.title,
      book.authors[0]?.author.name,
      Math.min(limit, 3),
    );

    return results.map((r) => ({
      openLibraryKey: r.openLibraryId ?? '',
      title: r.title ?? book.title,
      authors: r.authors ?? [],
      year: r.publishedDate
        ? new Date(r.publishedDate).getUTCFullYear()
        : undefined,
      coverUrl: r.coverUrl,
      isbn13: r.isbn13,
    }));
  }

  // ── Scope resolution ──────────────────────────────────────────────────────

  async resolveBookIds(
    scope: 'all' | 'library' | 'shelf',
    scopeId?: string,
  ): Promise<string[]> {
    if (scope === 'all') {
      const books = await this.prisma.book.findMany({
        select: { id: true },
        orderBy: { title: 'asc' },
      });
      return books.map((b) => b.id);
    }

    if (scope === 'library') {
      if (!scopeId)
        throw new NotFoundException('scopeId required for library scope');
      const books = await this.prisma.book.findMany({
        where: {
          OR: [
            { libraryId: scopeId },
            { userLibraries: { some: { libraryId: scopeId } } },
          ],
        },
        select: { id: true },
        orderBy: { title: 'asc' },
      });
      return books.map((b) => b.id);
    }

    // shelf — check both regular and smart shelves
    if (!scopeId)
      throw new NotFoundException('scopeId required for shelf scope');
    const shelf = await this.prisma.shelf.findUnique({
      where: { id: scopeId },
      include: { _count: { select: { rules: true } } },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');

    if (shelf.isSmart) {
      // For smart shelves, use the existing books from shelf books table is not applicable.
      // Smart shelf rules are dynamic — just get books from shelves join
      const shelfBooks = await this.prisma.bookShelf.findMany({
        where: { shelfId: scopeId },
        select: { bookId: true },
        orderBy: { addedAt: 'asc' },
      });
      return shelfBooks.map((b) => b.bookId);
    }

    const shelfBooks = await this.prisma.bookShelf.findMany({
      where: { shelfId: scopeId },
      select: { bookId: true },
      orderBy: { addedAt: 'asc' },
    });
    return shelfBooks.map((b) => b.bookId);
  }

  // ── Bulk run ──────────────────────────────────────────────────────────────

  async startBulkRun(opts: {
    scope: 'all' | 'library' | 'shelf';
    scopeId?: string;
    overwrite?: boolean;
    guidedSelections?: GuidedSelectionDto[];
    throttleMs?: number;
  }): Promise<{ taskId: string; total: number }> {
    const bookIds = await this.resolveBookIds(opts.scope, opts.scopeId);

    const task = await this.prisma.task.create({
      data: {
        type: 'BULK_METADATA_MATCH',
        status: 'PENDING',
        payload: JSON.stringify({ processed: 0, total: bookIds.length }),
      },
    });

    // Fire and forget — runs in background
    void this.runBulkEnrichment(task.id, bookIds, opts);

    return { taskId: task.id, total: bookIds.length };
  }

  async getRecentTasks(limit = 20) {
    const tasks = await this.prisma.task.findMany({
      where: { type: 'BULK_METADATA_MATCH' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return tasks.map((t) => ({
      id: t.id,
      status: t.status,
      payload: t.payload
        ? (JSON.parse(t.payload) as Record<string, unknown>)
        : null,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async getTask(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    return {
      id: task.id,
      status: task.status,
      payload: task.payload
        ? (JSON.parse(task.payload) as Record<string, unknown>)
        : null,
      errorMessage: task.errorMessage,
    };
  }

  async cancelRun(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'CANCELLED' },
    });
  }

  private async runBulkEnrichment(
    taskId: string,
    bookIds: string[],
    opts: {
      overwrite?: boolean;
      guidedSelections?: GuidedSelectionDto[];
      throttleMs?: number;
    },
  ) {
    try {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'PROCESSING' },
      });

      const fieldConfig = await this.getFieldConfig();
      const throttleMs = opts.throttleMs ?? (await this.getThrottle());
      const overwrite = opts.overwrite ?? false;
      const autoWrite = await this.getAutoWriteOnEnrich();

      const guidedMap = new Map<string, GuidedSelectionDto>(
        (opts.guidedSelections ?? []).map((s) => [s.bookId, s]),
      );

      // Group enabled fields by provider
      const providerFields = new Map<MetadataProvider, string[]>();
      for (const fc of fieldConfig.filter((f) => f.enabled)) {
        const provider = fc.provider as MetadataProvider;
        const existing = providerFields.get(provider) ?? [];
        existing.push(fc.field);
        providerFields.set(provider, existing);
      }

      // Canonical provider call order — OpenLibrary first to resolve ISBN
      const PROVIDER_ORDER: MetadataProvider[] = [
        MetadataProvider.OpenLibrary,
        MetadataProvider.GoogleBooks,
        MetadataProvider.Goodreads,
        MetadataProvider.Hardcover,
      ];
      const orderedProviders = PROVIDER_ORDER.filter((p) =>
        providerFields.has(p),
      );

      for (let i = 0; i < bookIds.length; i++) {
        // Check for cancellation
        const taskCheck = await this.prisma.task.findUnique({
          where: { id: taskId },
          select: { status: true },
        });
        if (taskCheck?.status === 'CANCELLED') break;

        const bookId = bookIds[i];

        const book = await this.prisma.book.findUnique({
          where: { id: bookId },
          include: { authors: { include: { author: true } } },
        });
        if (!book) continue;

        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            payload: JSON.stringify({
              processed: i,
              total: bookIds.length,
              currentBookTitle: book.title,
            }),
          },
        });

        const guided = guidedMap.get(bookId);
        let resolvedIsbn13: string | undefined = book.isbn13 ?? undefined;

        // If guided selection provides an ISBN, use it from the start
        if (guided?.isbn13) {
          resolvedIsbn13 = guided.isbn13;
        }

        for (const provider of orderedProviders) {
          const fields = providerFields.get(provider)!;
          let result: MetadataResult | null;

          // For OpenLibrary with guided selection, fetch by the chosen work key
          if (
            provider === MetadataProvider.OpenLibrary &&
            guided?.openLibraryKey
          ) {
            result = await this.openLibrary.fetchByKey(guided.openLibraryKey);
          } else {
            result = await this.metadataService.fetchFromProvider(provider, {
              title: book.title,
              authors: book.authors.map((ba) => ba.author.name),
              isbn13: resolvedIsbn13,
            });
          }

          if (result) {
            // Chain ISBN from OpenLibrary to subsequent providers
            if (provider === MetadataProvider.OpenLibrary && result.isbn13) {
              resolvedIsbn13 = result.isbn13;
            }
            await this.applyResultFields(bookId, result, fields, overwrite);
          }

          if (throttleMs > 0) {
            await sleep(throttleMs);
          }
        }

        // Auto-write metadata to epub after enrichment if enabled
        if (autoWrite) {
          const epubFile = await this.prisma.bookFile.findFirst({
            where: { bookId, format: 'EPUB', missingAt: null },
            select: { filePath: true },
          });
          if (epubFile) {
            try {
              await this.booksService.writeEpubMetadataForFile(
                bookId,
                epubFile.filePath,
              );
            } catch (writeErr) {
              this.logger.warn(
                `Auto-write epub failed for book ${bookId}: ${(writeErr as Error).message}`,
              );
            }
          }
        }
      }

      const finalCheck = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (finalCheck?.status !== 'CANCELLED') {
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'COMPLETED',
            payload: JSON.stringify({
              processed: bookIds.length,
              total: bookIds.length,
            }),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Bulk metadata run ${taskId} failed: ${(err as Error).message}`,
      );
      await this.prisma.task
        .update({
          where: { id: taskId },
          data: { status: 'FAILED', errorMessage: (err as Error).message },
        })
        .catch(() => {});
    }
  }

  // ── Field-level apply ─────────────────────────────────────────────────────

  private async applyResultFields(
    bookId: string,
    result: MetadataResult,
    fields: string[],
    overwrite: boolean,
  ): Promise<void> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: {
        title: true,
        subtitle: true,
        description: true,
        publisher: true,
        publishedDate: true,
        language: true,
        isbn13: true,
        isbn10: true,
        pageCount: true,
        googleBooksId: true,
        openLibraryId: true,
        goodreadsId: true,
        goodreadsRating: true,
        asin: true,
        lockedFields: true,
      },
    });
    if (!book) return;

    const locked = new Set<string>(
      JSON.parse(book.lockedFields ?? '[]') as string[],
    );
    const fieldSet = new Set(fields);

    const update: Record<string, unknown> = {};

    function shouldSet(field: string): boolean {
      return fieldSet.has(field) && !locked.has(field);
    }

    function isEmpty(val: unknown): boolean {
      return val === null || val === undefined || val === '';
    }

    if (
      shouldSet('title') &&
      result.title &&
      (overwrite || isEmpty(book.title))
    ) {
      update.title = result.title;
    }
    if (
      shouldSet('subtitle') &&
      result.subtitle &&
      (overwrite || isEmpty(book.subtitle))
    ) {
      update.subtitle = result.subtitle;
    }
    if (
      shouldSet('description') &&
      result.description &&
      (overwrite || isEmpty(book.description))
    ) {
      update.description = result.description;
    }
    if (
      shouldSet('publisher') &&
      result.publisher &&
      (overwrite || isEmpty(book.publisher))
    ) {
      update.publisher = result.publisher;
    }
    if (
      shouldSet('publishedDate') &&
      result.publishedDate &&
      (overwrite || isEmpty(book.publishedDate))
    ) {
      update.publishedDate = result.publishedDate;
    }
    if (
      shouldSet('language') &&
      result.language &&
      (overwrite || isEmpty(book.language))
    ) {
      update.language = result.language;
    }
    if (
      shouldSet('isbn13') &&
      result.isbn13 &&
      (overwrite || isEmpty(book.isbn13))
    ) {
      update.isbn13 = result.isbn13;
    }
    if (
      shouldSet('isbn10') &&
      result.isbn10 &&
      (overwrite || isEmpty(book.isbn10))
    ) {
      update.isbn10 = result.isbn10;
    }
    if (
      shouldSet('pageCount') &&
      result.pageCount &&
      (overwrite || isEmpty(book.pageCount))
    ) {
      update.pageCount = result.pageCount;
    }
    if (
      shouldSet('googleBooksId') &&
      result.googleBooksId &&
      (overwrite || isEmpty(book.googleBooksId))
    ) {
      update.googleBooksId = result.googleBooksId;
    }
    if (
      shouldSet('openLibraryId') &&
      result.openLibraryId &&
      (overwrite || isEmpty(book.openLibraryId))
    ) {
      update.openLibraryId = result.openLibraryId;
    }
    if (
      shouldSet('goodreadsId') &&
      result.goodreadsId &&
      (overwrite || isEmpty(book.goodreadsId))
    ) {
      update.goodreadsId = result.goodreadsId;
    }
    if (
      shouldSet('goodreadsRating') &&
      result.goodreadsRating != null &&
      (overwrite || isEmpty(book.goodreadsRating))
    ) {
      update.goodreadsRating = result.goodreadsRating;
    }
    if (shouldSet('asin') && result.asin && (overwrite || isEmpty(book.asin))) {
      update.asin = result.asin;
    }

    if (Object.keys(update).length > 0) {
      await this.prisma.book.update({ where: { id: bookId }, data: update });
    }

    // Relation fields
    if (shouldSet('authors') && result.authors?.length) {
      await this.metadataService.upsertBookAuthors(
        bookId,
        result.authors,
        locked,
      );
    }
    if (shouldSet('genres') && result.genres?.length) {
      await this.metadataService.upsertBookGenres(
        bookId,
        result.genres,
        locked,
      );
    }
    if (shouldSet('tags') && result.categories?.length) {
      await this.metadataService.upsertBookTags(
        bookId,
        result.categories,
        locked,
      );
    }
    if (shouldSet('seriesName') && result.seriesName) {
      await this.metadataService.upsertBookSeries(
        bookId,
        result.seriesName,
        result.seriesPosition,
        result.seriesTotalBooks,
        locked,
      );
    }
  }
}
