import {
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { extractFileMetadata } from '../common/extract-file-metadata';
import { findSidecar } from '../common/find-sidecar';
import { DatabaseService } from '../database/database.service';
import {
  MetadataService,
  MetadataProvider,
} from '../metadata/metadata.service';
import type { MetadataResult } from '../metadata/interfaces/metadata-result.interface';

export class GetBooksQueryDto {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'title' | 'publishedDate';
  order?: 'asc' | 'desc';
  libraryId?: string;
  q?: string;
}

export class UpdateBookDto {
  // User review
  rating?: number;
  readStatus?: string;
  libraryId?: string;

  // Metadata fields (book table)
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  language?: string | null;
  pageCount?: number | null;
  ageRating?: string | null;
  lockedFields?: string[];

  // Cover (fetched from URL and stored as coverData)
  coverUrl?: string;
  goodreadsRating?: number;

  // Relational
  authors?: string[];
  tags?: string[];
  genres?: string[];
  moods?: string[];
  seriesName?: string | null;
  seriesSequence?: number | null;
  seriesTotalBooks?: number | null;
}

@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly metadataService: MetadataService,
  ) {}

  async findAll(query: GetBooksQueryDto, userId: string) {
    const books = await this.prisma.book.findMany({
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
      orderBy: { [query.sortBy ?? 'createdAt']: query.order ?? 'desc' },
      where: query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              {
                authors: {
                  some: {
                    author: {
                      name: { contains: query.q, mode: 'insensitive' },
                    },
                  },
                },
              },
              {
                series: {
                  some: {
                    series: {
                      name: { contains: query.q, mode: 'insensitive' },
                    },
                  },
                },
              },
              { isbn13: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : query.libraryId
          ? { userLibraries: { some: { libraryId: query.libraryId, userId } } }
          : undefined,
      include: {
        authors: { include: { author: true } },
        files: { select: { format: true, missingAt: true } },
        series: { include: { series: { select: { id: true, name: true } } } },
        readingProgress: { where: { userId }, select: { percentage: true } },
        reviews: {
          where: { userId },
          select: { rating: true, readStatus: true },
        },
        tags: { select: { name: true } },
        genres: { select: { name: true } },
      },
    });

    return books.map((book) => ({
      id: book.id,
      title: book.title,
      authors: book.authors.map((ba) => ba.author.name),
      hasCover: book.coverData !== null,
      coverUpdatedAt: book.updatedAt.toISOString(),
      createdAt: book.createdAt,
      formats: [...new Set(book.files.map((f) => f.format))].sort(),
      hasFileMissing: book.files.some((f) => f.missingAt !== null),
      seriesName: book.series[0]?.series.name ?? null,
      seriesSequence: book.series[0]?.sequence ?? null,
      publishedDate: book.publishedDate,
      readingProgress: book.readingProgress[0]?.percentage ?? null,
      readStatus: book.reviews[0]?.readStatus ?? null,
      rating: book.reviews[0]?.rating ?? null,
      genres: book.genres.map((g) => g.name),
      tags: book.tags.map((t) => t.name),
    }));
  }

  async getCoverData(bookId: string): Promise<Buffer | null> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { coverData: true },
    });
    if (!book || !book.coverData) return null;
    return Buffer.from(book.coverData);
  }

  async findOne(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        authors: { include: { author: true } },
        files: true,
        tags: true,
        genres: true,
        moods: true,
        series: {
          include: {
            series: { select: { id: true, name: true, totalBooks: true } },
          },
        },
        userLibraries: {
          where: { userId },
          include: { library: { select: { id: true, name: true } } },
        },
        reviews: {
          where: { userId },
          select: { rating: true, readStatus: true },
        },
        shelves: {
          where: { shelf: { userId } },
          include: { shelf: { select: { id: true, name: true } } },
        },
      },
    });
    if (!book) throw new NotFoundException('Book not found');

    const review = book.reviews[0] ?? null;
    const userLibrary = book.userLibraries[0]?.library ?? null;
    const seriesBook = book.series[0] ?? null;

    return {
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      description: book.description,
      isbn13: book.isbn13,
      isbn10: book.isbn10,
      goodreadsId: book.goodreadsId,
      goodreadsRating: book.goodreadsRating,
      publisher: book.publisher,
      publishedDate: book.publishedDate,
      language: book.language,
      pageCount: book.pageCount,
      ageRating: book.ageRating,
      lockedFields: JSON.parse(book.lockedFields) as string[],
      hasCover: book.coverData !== null,
      coverUpdatedAt: book.updatedAt.toISOString(),
      library: userLibrary,
      authors: book.authors.map((ba) => ba.author.name),
      tags: book.tags.map((t) => t.name),
      genres: book.genres.map((g) => g.name),
      moods: book.moods.map((m) => m.name),
      series: seriesBook
        ? {
            name: seriesBook.series.name,
            sequence: seriesBook.sequence ?? null,
            totalBooks: seriesBook.series.totalBooks ?? null,
          }
        : null,
      files: book.files.map((f) => ({
        id: f.id,
        format: f.format,
        sizeBytes: f.sizeBytes.toString(),
        filePath: f.filePath,
        missingAt: f.missingAt,
      })),
      userReview: {
        rating: review?.rating ?? null,
        readStatus: review?.readStatus ?? 'UNREAD',
      },
      shelves: book.shelves.map((bs) => ({
        id: bs.shelf.id,
        name: bs.shelf.name,
      })),
      sidecarFile: book.sidecarFile,
    };
  }

  async updateBookShelves(bookId: string, userId: string, shelfIds: string[]) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');

    if (shelfIds.length > 0) {
      const count = await this.prisma.shelf.count({
        where: { id: { in: shelfIds }, userId },
      });
      if (count !== shelfIds.length) {
        throw new BadRequestException(
          'One or more shelves not found or not owned by user',
        );
      }
    }

    const current = await this.prisma.bookShelf.findMany({
      where: { bookId, shelf: { userId } },
      select: { shelfId: true },
    });
    const currentIds = current.map((bs) => bs.shelfId);

    const toAdd = shelfIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !shelfIds.includes(id));

    await this.prisma.$transaction([
      ...toAdd.map((shelfId) =>
        this.prisma.bookShelf.create({ data: { bookId, shelfId } }),
      ),
      ...(toRemove.length > 0
        ? [
            this.prisma.bookShelf.deleteMany({
              where: { bookId, shelfId: { in: toRemove } },
            }),
          ]
        : []),
    ]);

    return { success: true };
  }

  async updateBook(bookId: string, userId: string, dto: UpdateBookDto) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');

    this.logger.log(`updateBook: bookId=${bookId}`);

    const ops: Promise<unknown>[] = [];

    // User review
    if (dto.rating !== undefined || dto.readStatus !== undefined) {
      ops.push(
        this.prisma.userReview.upsert({
          where: { userId_bookId: { userId, bookId } },
          update: {
            ...(dto.rating !== undefined && { rating: dto.rating }),
            ...(dto.readStatus !== undefined && { readStatus: dto.readStatus }),
          },
          create: {
            userId,
            bookId,
            rating: dto.rating ?? null,
            readStatus: dto.readStatus ?? 'UNREAD',
          },
        }),
      );
    }

    // Library assignment
    if (dto.libraryId !== undefined) {
      const lib = await this.prisma.library.findFirst({
        where: { id: dto.libraryId, userId },
      });
      if (!lib)
        throw new BadRequestException('Library not found or not owned by user');

      ops.push(
        this.prisma.userBookLibrary.upsert({
          where: { userId_bookId: { userId, bookId } },
          update: { libraryId: dto.libraryId },
          create: { userId, bookId, libraryId: dto.libraryId },
        }),
      );
    }

    // Scalar metadata fields
    const bookUpdate: Record<string, unknown> = {};
    if (dto.title !== undefined) bookUpdate.title = dto.title;
    if (dto.subtitle !== undefined) bookUpdate.subtitle = dto.subtitle;
    if (dto.description !== undefined) bookUpdate.description = dto.description;
    if (dto.isbn13 !== undefined) bookUpdate.isbn13 = dto.isbn13;
    if (dto.isbn10 !== undefined) bookUpdate.isbn10 = dto.isbn10;
    if (dto.publisher !== undefined) bookUpdate.publisher = dto.publisher;
    if (dto.publishedDate !== undefined) {
      bookUpdate.publishedDate = dto.publishedDate
        ? new Date(dto.publishedDate)
        : null;
    }
    if (dto.language !== undefined) bookUpdate.language = dto.language;
    if (dto.pageCount !== undefined) bookUpdate.pageCount = dto.pageCount;
    if (dto.ageRating !== undefined) bookUpdate.ageRating = dto.ageRating;
    if (dto.goodreadsRating !== undefined)
      bookUpdate.goodreadsRating = dto.goodreadsRating;
    if (dto.lockedFields !== undefined) {
      bookUpdate.lockedFields = JSON.stringify(dto.lockedFields);
    }
    if (dto.coverUrl) {
      try {
        this.logger.debug(`Fetching cover from: ${dto.coverUrl}`);
        const coverRes = await fetch(dto.coverUrl);
        if (coverRes.ok) {
          const buf = Buffer.from(await coverRes.arrayBuffer());
          this.logger.debug(
            `Cover fetched: ${buf.byteLength} bytes, type=${coverRes.headers.get('content-type')}`,
          );
          bookUpdate.coverData = buf;
        } else {
          this.logger.warn(
            `Cover fetch returned HTTP ${coverRes.status} for: ${dto.coverUrl}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch cover from ${dto.coverUrl}: ${(err as Error).message}`,
        );
      }
    }

    if (Object.keys(bookUpdate).length > 0) {
      ops.push(
        this.prisma.book.update({ where: { id: bookId }, data: bookUpdate }),
      );
    }

    await Promise.all(ops);

    // Relational updates — run in parallel
    const relationalOps: Promise<unknown>[] = [];
    if (dto.authors !== undefined)
      relationalOps.push(this.replaceAuthors(bookId, dto.authors));
    if (dto.tags !== undefined)
      relationalOps.push(this.setStringRelation(bookId, 'tags', dto.tags));
    if (dto.genres !== undefined)
      relationalOps.push(this.setStringRelation(bookId, 'genres', dto.genres));
    if (dto.moods !== undefined)
      relationalOps.push(this.setStringRelation(bookId, 'moods', dto.moods));
    if (dto.seriesName !== undefined)
      relationalOps.push(this.replaceSeries(bookId, dto));
    await Promise.all(relationalOps);

    return { success: true };
  }

  private async replaceAuthors(
    bookId: string,
    authors: string[],
  ): Promise<void> {
    await this.prisma.bookAuthor.deleteMany({ where: { bookId } });
    for (const name of authors) {
      const trimmed = name.trim();
      if (!trimmed) continue;
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
    }
  }

  private async setStringRelation(
    bookId: string,
    relation: 'tags' | 'genres' | 'moods',
    names: string[],
  ): Promise<void> {
    const args = (name: string) => ({
      where: { name },
      update: {},
      create: { name },
    });
    const records: Array<{ id: string }> = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      let record: { id: string };
      if (relation === 'tags')
        record = await this.prisma.tag.upsert(args(trimmed));
      else if (relation === 'genres')
        record = await this.prisma.genre.upsert(args(trimmed));
      else record = await this.prisma.mood.upsert(args(trimmed));
      records.push({ id: record.id });
    }
    await this.prisma.book.update({
      where: { id: bookId },
      data: { [relation]: { set: records } },
    });
  }

  private async replaceSeries(
    bookId: string,
    dto: UpdateBookDto,
  ): Promise<void> {
    // Snapshot existing series links so we can prune orphans afterward
    const oldLinks = await this.prisma.seriesBook.findMany({
      where: { bookId },
      include: { series: { select: { id: true, name: true } } },
    });

    if (dto.seriesName === null || dto.seriesName === '') {
      this.logger.debug(
        `replaceSeries: removing all series links for bookId=${bookId}`,
      );
      await this.prisma.seriesBook.deleteMany({ where: { bookId } });
      await this.pruneOrphanedSeries(oldLinks.map((l) => l.series));
      return;
    }

    this.logger.debug(
      `replaceSeries: bookId=${bookId} → "${dto.seriesName}" (seq=${dto.seriesSequence ?? null}, totalBooks=${dto.seriesTotalBooks ?? null})`,
    );
    if (oldLinks.length > 0) {
      this.logger.debug(
        `replaceSeries: removing old links: ${oldLinks.map((l) => `"${l.series.name}"`).join(', ')}`,
      );
    }

    const seriesData =
      dto.seriesTotalBooks !== undefined
        ? { totalBooks: dto.seriesTotalBooks }
        : {};

    const series = await this.prisma.series.upsert({
      where: { name: dto.seriesName! },
      update: seriesData,
      create: { name: dto.seriesName!, ...seriesData },
    });

    this.logger.debug(
      `replaceSeries: resolved series id=${series.id} name="${series.name}"`,
    );

    // Remove ALL existing series links for this book, then create exactly one
    await this.prisma.seriesBook.deleteMany({ where: { bookId } });
    await this.prisma.seriesBook.create({
      data: {
        seriesId: series.id,
        bookId,
        sequence: dto.seriesSequence ?? null,
      },
    });

    // Prune any series that now have no books (excluding the one we just used)
    await this.pruneOrphanedSeries(
      oldLinks.map((l) => l.series).filter((s) => s.id !== series.id),
    );
  }

  private async pruneOrphanedSeries(
    candidates: Array<{ id: string; name: string }>,
  ): Promise<void> {
    for (const s of candidates) {
      const remaining = await this.prisma.seriesBook.count({
        where: { seriesId: s.id },
      });
      if (remaining === 0) {
        await this.prisma.series.delete({ where: { id: s.id } });
        this.logger.debug(
          `pruneOrphanedSeries: deleted empty series id=${s.id} name="${s.name}"`,
        );
      }
    }
  }

  async applyExternalMetadata(
    bookId: string,
    provider: MetadataProvider,
    userId: string,
  ) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: { authors: { include: { author: true } } },
    });
    if (!book) throw new NotFoundException('Book not found');

    await this.metadataService.enrichBookForProvider(bookId, provider, {
      title: book.title,
      authors: book.authors.map((ba) => ba.author.name),
      isbn13: book.isbn13 ?? undefined,
    });

    return this.findOne(bookId, userId);
  }

  async searchExternalMetadata(
    bookId: string,
    provider: MetadataProvider,
    overrides?: { title?: string; author?: string; isbn?: string },
  ) {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: { authors: { include: { author: true } } },
    });
    if (!book) throw new NotFoundException('Book not found');

    return this.metadataService.searchFromProvider(provider, {
      title: overrides?.title ?? book.title,
      authors: overrides?.author
        ? [overrides.author]
        : book.authors.map((ba) => ba.author.name),
      isbn13: overrides?.isbn ?? book.isbn13 ?? undefined,
    });
  }

  async downloadFile(bookId: string, fileId: string) {
    const file = await this.prisma.bookFile.findFirst({
      where: { id: fileId, bookId },
    });
    if (!file) throw new NotFoundException('File not found');
    if (file.missingAt !== null)
      throw new GoneException('File is missing from disk');
    return { filePath: file.filePath, format: file.format };
  }

  async getPreferredFile(bookId: string) {
    const files = await this.prisma.bookFile.findMany({
      where: { bookId, missingAt: null },
    });
    if (!files.length)
      throw new NotFoundException('No file found for this book');
    const READABLE_FORMATS = ['EPUB', 'MOBI', 'AZW', 'AZW3'];
    const preferred =
      READABLE_FORMATS.map((fmt) => files.find((f) => f.format === fmt)).find(
        Boolean,
      ) ?? files[0];
    return { filePath: preferred.filePath, format: preferred.format };
  }

  async getFileMetadata(bookId: string) {
    const file = await this.prisma.bookFile.findFirst({
      where: { bookId, missingAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!file)
      throw new NotFoundException('No accessible file found for this book');

    const ext = path.extname(file.filePath).toLowerCase();
    const format = ext.replace('.', '').toUpperCase();

    const METADATA_FORMATS = ['.epub', '.mobi', '.azw', '.azw3'];
    if (!METADATA_FORMATS.includes(ext)) {
      throw new BadRequestException(
        `Format ${format} does not support metadata extraction`,
      );
    }

    const meta = await extractFileMetadata(file.filePath);

    return {
      format,
      title: meta.title || undefined,
      authors: meta.authors.length ? meta.authors : undefined,
      description: meta.description,
      publishedDate: meta.publishedDate?.toISOString(),
      publisher: meta.publisher,
      language: meta.language,
      subjects: meta.subjects,
      ids: meta.ids,
      contributor: meta.contributor,
      rights: meta.rights,
      source: meta.source,
      coverage: meta.coverage,
      relation: meta.relation,
      type: meta.type,
    };
  }

  async getSidecarContent(bookId: string): Promise<MetadataResult | null> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { sidecarFile: true },
    });
    if (!book?.sidecarFile || !fs.existsSync(book.sidecarFile)) return null;
    return JSON.parse(
      fs.readFileSync(book.sidecarFile, 'utf8'),
    ) as MetadataResult;
  }

  async scanForSidecar(bookId: string): Promise<string | null> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: { files: { where: { missingAt: null } } },
    });
    if (!book) throw new NotFoundException('Book not found');

    for (const file of book.files) {
      const found = findSidecar(file.filePath, book.title);
      if (found) {
        await this.prisma.book.update({
          where: { id: bookId },
          data: { sidecarFile: found },
        });
        return found;
      }
    }

    await this.prisma.book.update({
      where: { id: bookId },
      data: { sidecarFile: null },
    });
    return null;
  }

  async exportSidecar(
    bookId: string,
  ): Promise<{ filename: string; json: MetadataResult }> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        authors: { include: { author: true } },
        tags: true,
        genres: true,
        moods: true,
        series: { include: { series: true } },
      },
    });
    if (!book) throw new NotFoundException('Book not found');

    const seriesBook = book.series[0] ?? null;

    const json: MetadataResult = {
      title: book.title,
      subtitle: book.subtitle ?? undefined,
      authors: book.authors.map((ba) => ba.author.name),
      description: book.description ?? undefined,
      publishedDate: book.publishedDate
        ? (book.publishedDate.toISOString().slice(0, 10) as unknown as Date)
        : undefined,
      publisher: book.publisher ?? undefined,
      language: book.language ?? undefined,
      pageCount: book.pageCount ?? undefined,
      isbn13: book.isbn13 ?? undefined,
      isbn10: book.isbn10 ?? undefined,
      categories: book.tags.map((t) => t.name),
      genres: book.genres.map((g) => g.name),
      moods: book.moods.map((m) => m.name),
      seriesName: seriesBook?.series.name ?? undefined,
      seriesPosition: seriesBook?.sequence ?? undefined,
      seriesTotalBooks: seriesBook?.series.totalBooks ?? undefined,
      goodreadsId: book.goodreadsId ?? undefined,
      goodreadsRating: book.goodreadsRating ?? undefined,
      googleBooksId: book.googleBooksId ?? undefined,
      openLibraryId: book.openLibraryId ?? undefined,
      asin: book.amazonId ?? undefined,
    };

    const filename =
      book.title.replace(/[/\\:*?"<>|]/g, '_') + '.metadata.json';
    return { filename, json };
  }

  async matchBook(targetBookId: string, sourceBookId: string) {
    if (targetBookId === sourceBookId) {
      throw new BadRequestException('Source and target book must be different');
    }
    const target = await this.prisma.book.findUnique({
      where: { id: targetBookId },
    });
    if (!target) throw new NotFoundException('Target book not found');

    await this.prisma.$transaction([
      this.prisma.bookFile.updateMany({
        where: { bookId: sourceBookId },
        data: { bookId: targetBookId },
      }),
      this.prisma.book.delete({ where: { id: sourceBookId } }),
    ]);

    return { success: true };
  }
}
