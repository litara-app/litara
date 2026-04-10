import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { MetadataProvider } from '../metadata/metadata.service';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { LibraryWriteService } from '../library/library-write.service';
import { MetadataService } from '../metadata/metadata.service';
import { PendingBook, PendingBookStatus } from '@prisma/client';
import { UpdatePendingBookDto } from './dto/pending-book.dto';
import * as chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

const SUPPORTED_FORMATS = ['epub', 'mobi', 'azw', 'azw3', 'cbz', 'pdf'];

@Injectable()
export class BookDropService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookDropService.name);
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly libraryWriteService: LibraryWriteService,
    private readonly metadataService: MetadataService,
  ) {}

  onModuleInit() {
    this.startWatcher();
  }

  onModuleDestroy() {
    void this.watcher?.close();
  }

  private startWatcher() {
    const dropPath = this.config.get<string>('bookDropPath');
    if (!dropPath) {
      this.logger.warn(
        'Book drop folder not configured — drop folder ingestion disabled. Set BOOK_DROP_PATH to enable.',
      );
      return;
    }
    if (!fs.existsSync(dropPath)) {
      this.logger.warn(
        `BOOK_DROP_PATH "${dropPath}" does not exist — drop folder ingestion disabled.`,
      );
      return;
    }

    this.logger.log(`Watching book drop folder: ${dropPath}`);
    this.watcher = chokidar.watch(dropPath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    });

    this.watcher.on('add', (filePath: string) => {
      if (this.isSupportedFile(filePath)) {
        this.logger.log(`Drop folder file detected: ${filePath}`);
        this.ingestFile(filePath).catch((err) =>
          this.logger.error(`Error ingesting drop file ${filePath}`, err),
        );
      }
    });
  }

  private isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return SUPPORTED_FORMATS.includes(ext);
  }

  async ingestFile(
    filePath: string,
  ): Promise<{ pendingBook: PendingBook; isNew: boolean }> {
    const fileHash = await this.computeHash(filePath);

    const existing = await this.prisma.pendingBook.findFirst({
      where: { fileHash },
    });
    if (existing) {
      return { pendingBook: existing, isNew: false };
    }

    const metadata =
      await this.libraryWriteService.extractMetadataFromFile(filePath);
    const originalFilename = path.basename(filePath);

    const pendingBook = await this.prisma.pendingBook.create({
      data: {
        stagedFilePath: filePath,
        fileHash,
        originalFilename,
        title: metadata.title || null,
        authors: JSON.stringify(metadata.authors ?? []),
        publisher: metadata.publisher ?? null,
        language: metadata.language ?? null,
        description: metadata.description ?? null,
        isbn13: metadata.isbn13 ?? null,
      },
    });

    this.logger.log(
      `PendingBook created: "${pendingBook.title ?? originalFilename}" [${pendingBook.id}]`,
    );
    return { pendingBook, isNew: true };
  }

  async ingestUploadedFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    if (!SUPPORTED_FORMATS.includes(ext)) {
      fs.rmSync(filePath, { force: true });
      throw new ConflictException(`Unsupported file format: .${ext}`);
    }

    const result = await this.ingestFile(filePath);
    if (!result.isNew) {
      fs.rmSync(filePath, { force: true });
      throw new ConflictException({
        message: 'This file already exists in the pending queue',
        existingId: result.pendingBook.id,
      });
    }
    return result.pendingBook;
  }

  listPending() {
    return this.prisma.pendingBook.findMany({
      where: {
        status: {
          in: [PendingBookStatus.PENDING, PendingBookStatus.COLLISION],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMetadata(id: string, dto: UpdatePendingBookDto) {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');

    return this.prisma.pendingBook.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.authors !== undefined && {
          authors: JSON.stringify(dto.authors),
        }),
        ...(dto.seriesName !== undefined && { seriesName: dto.seriesName }),
        ...(dto.seriesPosition !== undefined && {
          seriesPosition: dto.seriesPosition,
        }),
        ...(dto.seriesTotalBooks !== undefined && {
          seriesTotalBooks: dto.seriesTotalBooks,
        }),
        ...(dto.publisher !== undefined && { publisher: dto.publisher }),
        ...(dto.publishedDate !== undefined && {
          publishedDate: new Date(dto.publishedDate),
        }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isbn10 !== undefined && { isbn10: dto.isbn10 }),
        ...(dto.isbn13 !== undefined && { isbn13: dto.isbn13 }),
        ...(dto.pageCount !== undefined && { pageCount: dto.pageCount }),
        ...(dto.genres !== undefined && { genres: JSON.stringify(dto.genres) }),
        ...(dto.tags !== undefined && { tags: JSON.stringify(dto.tags) }),
        ...(dto.moods !== undefined && { moods: JSON.stringify(dto.moods) }),
        ...(dto.googleBooksId !== undefined && {
          googleBooksId: dto.googleBooksId,
        }),
        ...(dto.openLibraryId !== undefined && {
          openLibraryId: dto.openLibraryId,
        }),
        ...(dto.goodreadsId !== undefined && { goodreadsId: dto.goodreadsId }),
        ...(dto.asin !== undefined && { asin: dto.asin }),
        ...(dto.goodreadsRating !== undefined && {
          goodreadsRating: dto.goodreadsRating,
        }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
      },
    });
  }

  async searchMetadata(
    id: string,
    provider: MetadataProvider,
    overrides?: { title?: string; author?: string; isbn?: string },
  ) {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');
    const authors = JSON.parse(pending.authors) as string[];
    return this.metadataService.searchFromProvider(provider, {
      title:
        overrides?.title ??
        pending.title ??
        pending.originalFilename.replace(/\.[^.]+$/, ''),
      authors: overrides?.author ? [overrides.author] : authors,
      isbn13: overrides?.isbn ?? pending.isbn13 ?? undefined,
    });
  }

  approve(id: string) {
    return this.libraryWriteService.approvePendingBook(id);
  }

  approveOverwrite(id: string) {
    return this.libraryWriteService.approveOverwrite(id);
  }

  async enrichPendingBook(id: string): Promise<PendingBook> {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');

    const title =
      pending.title ??
      path.basename(
        pending.originalFilename,
        path.extname(pending.originalFilename),
      );
    const authors = JSON.parse(pending.authors) as string[];

    const result = await this.metadataService.fetchBestMetadata({
      title,
      authors,
      isbn13: pending.isbn13,
    });

    if (!result) return pending;

    return this.prisma.pendingBook.update({
      where: { id },
      data: {
        ...(result.title && { title: result.title }),
        ...(result.subtitle && { subtitle: result.subtitle }),
        ...(result.authors?.length && {
          authors: JSON.stringify(result.authors),
        }),
        ...(result.seriesName && { seriesName: result.seriesName }),
        ...(result.seriesPosition != null && {
          seriesPosition: result.seriesPosition,
        }),
        ...(result.seriesTotalBooks != null && {
          seriesTotalBooks: result.seriesTotalBooks,
        }),
        ...(result.publisher && { publisher: result.publisher }),
        ...(result.publishedDate && {
          publishedDate: new Date(result.publishedDate),
        }),
        ...(result.language && { language: result.language }),
        ...(result.description && { description: result.description }),
        ...(result.isbn13 && { isbn13: result.isbn13 }),
        ...(result.isbn10 && { isbn10: result.isbn10 }),
        ...(result.pageCount != null && { pageCount: result.pageCount }),
        ...(result.genres?.length && { genres: JSON.stringify(result.genres) }),
        ...(result.categories?.length && {
          tags: JSON.stringify(result.categories),
        }),
        ...(result.moods?.length && { moods: JSON.stringify(result.moods) }),
        ...(result.googleBooksId && { googleBooksId: result.googleBooksId }),
        ...(result.openLibraryId && { openLibraryId: result.openLibraryId }),
        ...(result.goodreadsId && { goodreadsId: result.goodreadsId }),
        ...(result.asin && { asin: result.asin }),
        ...(result.goodreadsRating != null && {
          goodreadsRating: result.goodreadsRating,
        }),
        ...(result.coverUrl && { coverUrl: result.coverUrl }),
      },
    });
  }

  async approveAll(): Promise<{
    approved: number;
    collisions: number;
    failed: number;
  }> {
    const pending = await this.prisma.pendingBook.findMany({
      where: { status: PendingBookStatus.PENDING },
    });

    let approved = 0;
    let collisions = 0;
    let failed = 0;

    for (const book of pending) {
      try {
        await this.libraryWriteService.approvePendingBook(book.id);
        approved++;
      } catch (err) {
        if (err instanceof ConflictException) {
          collisions++;
        } else {
          failed++;
          this.logger.error(`Failed to approve book ${book.id}`, err);
        }
      }
    }

    return { approved, collisions, failed };
  }

  async reject(id: string) {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');
    if (pending.status === PendingBookStatus.APPROVED) {
      throw new ConflictException('Cannot reject an already-approved book');
    }
    const result = await this.prisma.pendingBook.update({
      where: { id },
      data: { status: PendingBookStatus.REJECTED },
    });
    fs.rmSync(pending.stagedFilePath, { force: true });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private computeHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
