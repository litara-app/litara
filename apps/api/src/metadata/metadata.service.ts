import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GoogleBooksService } from './providers/google-books.service';
import { OpenLibraryService } from './providers/open-library.service';
import { GoodreadsService } from './providers/goodreads.service';
import { MetadataResult } from './interfaces/metadata-result.interface';

export enum MetadataProvider {
  GoogleBooks = 'google-books',
  OpenLibrary = 'open-library',
  Goodreads = 'goodreads',
}

interface EnrichInput {
  title: string;
  authors: string[];
  isbn13?: string;
}

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly googleBooks: GoogleBooksService,
    private readonly openLibrary: OpenLibraryService,
    private readonly goodreads: GoodreadsService,
  ) {}

  async enrichBook(bookId: string, input: EnrichInput): Promise<void> {
    try {
      const result = await this.fetchMetadata(input);
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
    } else {
      result = input.isbn13
        ? await this.openLibrary.searchByIsbn(input.isbn13)
        : await this.openLibrary.searchByTitleAuthor(input.title, firstAuthor);
    }

    return result;
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
    if (result.asin) update.amazonId = result.asin;
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

  private async fetchMetadata(
    input: EnrichInput,
  ): Promise<MetadataResult | null> {
    const firstAuthor = input.authors[0];
    let result: MetadataResult | null = null;

    if (input.isbn13) {
      // ISBN is authoritative — try both providers by ISBN only, no title fallback
      result = await this.googleBooks.searchByIsbn(input.isbn13);
      if (!result) result = await this.openLibrary.searchByIsbn(input.isbn13);
    } else {
      // No ISBN — fall back to title/author search across both providers
      result = await this.googleBooks.searchByTitleAuthor(
        input.title,
        firstAuthor,
      );
      if (!result)
        result = await this.openLibrary.searchByTitleAuthor(
          input.title,
          firstAuthor,
        );
    }

    return result;
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
