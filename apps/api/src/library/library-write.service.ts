import * as fs from 'fs';
import * as path from 'path';
import { computeKoReaderHash } from '../common/koreader-hash';
import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { DiskWriteGuardService } from '../common/disk-write-guard.service';
import { PendingBookStatus } from '@prisma/client';
import { extractFileMetadata } from '../common/extract-file-metadata';
import { EPub } from 'epub2';
import { extractMobiCover } from '@litara/mobi-parser';
import { extractCbzCover } from '@litara/cbz-parser';

/** Characters illegal in Windows/Linux/macOS path segments */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

@Injectable()
export class LibraryWriteService {
  private readonly logger = new Logger(LibraryWriteService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly diskWriteGuard: DiskWriteGuardService,
  ) {}

  // ---------------------------------------------------------------------------
  // Path computation
  // ---------------------------------------------------------------------------

  computeTargetPath(opts: {
    libraryRoot: string;
    authors: string[];
    seriesName?: string | null;
    title?: string | null;
    originalFilename: string;
    ext: string;
  }): string {
    const { libraryRoot, authors, seriesName, title, originalFilename, ext } =
      opts;

    const sanitize = (s: string) =>
      s
        .normalize('NFC')
        .replace(ILLEGAL_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);

    const firstAuthor = authors[0]?.trim();
    const safeAuthor = firstAuthor ? sanitize(firstAuthor) : null;
    const safeSeries = seriesName ? sanitize(seriesName) : null;
    const safeTitle = title ? sanitize(title) : null;
    const safeFilename = sanitize(originalFilename);
    const dotExt = ext.startsWith('.') ? ext : `.${ext}`;

    if (safeAuthor && safeSeries && safeTitle) {
      return path.join(
        libraryRoot,
        safeAuthor,
        safeSeries,
        `${safeTitle}${dotExt}`,
      );
    }
    if (safeAuthor && safeTitle) {
      return path.join(libraryRoot, safeAuthor, `${safeTitle}${dotExt}`);
    }
    if (safeTitle) {
      return path.join(libraryRoot, 'unknown', `${safeTitle}${dotExt}`);
    }
    return path.join(libraryRoot, 'unknown', safeFilename || originalFilename);
  }

  // ---------------------------------------------------------------------------
  // Approve: attempt to write a pending book to the library
  // ---------------------------------------------------------------------------

  async approvePendingBook(id: string): Promise<void> {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');
    if (
      pending.status === PendingBookStatus.APPROVED ||
      pending.status === PendingBookStatus.REJECTED
    ) {
      throw new ConflictException(
        `Cannot approve a book with status ${pending.status}`,
      );
    }

    await this.guardWrites();

    const libraryRoot = this.config.get<string>('ebookLibraryPath')!;
    const ext = path.extname(pending.stagedFilePath).toLowerCase();
    const authors = JSON.parse(pending.authors) as string[];

    const targetPath = this.computeTargetPath({
      libraryRoot,
      authors,
      seriesName: pending.seriesName,
      title: pending.title,
      originalFilename: pending.originalFilename,
      ext,
    });

    // Collision detection
    if (fs.existsSync(targetPath)) {
      await this.prisma.pendingBook.update({
        where: { id },
        data: {
          status: PendingBookStatus.COLLISION,
          targetPath,
          collidingPath: targetPath,
        },
      });
      throw new ConflictException({
        message: 'A file already exists at the target path',
        collidingPath: targetPath,
        targetPath,
      });
    }

    this.writeFile(pending.stagedFilePath, targetPath);
    await this.createLibraryRecord(pending, targetPath, authors, ext);

    await this.prisma.pendingBook.update({
      where: { id },
      data: { status: PendingBookStatus.APPROVED, targetPath },
    });

    fs.rmSync(pending.stagedFilePath, { force: true });
    this.logger.log(`Approved and wrote: ${targetPath}`);
  }

  // ---------------------------------------------------------------------------
  // Approve overwrite: write even if collision exists
  // ---------------------------------------------------------------------------

  async approveOverwrite(id: string): Promise<void> {
    const pending = await this.prisma.pendingBook.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('PendingBook not found');
    if (pending.status !== PendingBookStatus.COLLISION) {
      throw new ConflictException(
        'approve-overwrite is only valid for books with status COLLISION',
      );
    }

    await this.guardWrites();

    const libraryRoot = this.config.get<string>('ebookLibraryPath')!;
    const ext = path.extname(pending.stagedFilePath).toLowerCase();
    const authors = JSON.parse(pending.authors) as string[];

    const targetPath =
      pending.targetPath ??
      this.computeTargetPath({
        libraryRoot,
        authors,
        seriesName: pending.seriesName,
        title: pending.title,
        originalFilename: pending.originalFilename,
        ext,
      });

    this.writeFile(pending.stagedFilePath, targetPath);
    await this.createLibraryRecord(pending, targetPath, authors, ext);

    await this.prisma.pendingBook.update({
      where: { id },
      data: {
        status: PendingBookStatus.APPROVED,
        targetPath,
        overwriteApproved: true,
      },
    });

    fs.rmSync(pending.stagedFilePath, { force: true });
    this.logger.log(`Overwrote and approved: ${targetPath}`);
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async guardWrites(): Promise<void> {
    const libraryRoot = this.config.get<string>('ebookLibraryPath')!;

    const writable = this.diskWriteGuard.probeLibraryWritable(libraryRoot);
    if (!writable) {
      throw new ForbiddenException(
        'Library volume is mounted read-only. Cannot write files.',
      );
    }

    await this.diskWriteGuard.assertDiskWritesAllowed();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private writeFile(src: string, dest: string): void {
    if (!fs.existsSync(src)) {
      throw new NotFoundException(`Staged file not found: ${src}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to write file to library: ${(err as Error).message}`,
      );
    }
  }

  private async createLibraryRecord(
    pending: {
      id: string;
      stagedFilePath: string;
      fileHash: string;
      title: string | null;
      subtitle: string | null;
      originalFilename: string;
      description: string | null;
      publisher: string | null;
      publishedDate: Date | null;
      language: string | null;
      isbn13: string | null;
      isbn10: string | null;
      pageCount: number | null;
      genres: string;
      tags: string;
      moods: string;
      googleBooksId: string | null;
      openLibraryId: string | null;
      goodreadsId: string | null;
      asin: string | null;
      goodreadsRating: number | null;
      seriesName: string | null;
      seriesPosition: number | null;
      seriesTotalBooks: number | null;
    },
    targetPath: string,
    authors: string[],
    ext: string,
  ): Promise<void> {
    const stat = fs.statSync(targetPath);
    const format = ext.replace('.', '').toUpperCase();

    const book = await this.prisma.book.create({
      data: {
        title:
          pending.title ??
          path.basename(
            pending.originalFilename,
            path.extname(pending.originalFilename),
          ),
        subtitle: pending.subtitle ?? null,
        description: pending.description ?? null,
        publisher: pending.publisher ?? null,
        publishedDate: pending.publishedDate ?? null,
        language: pending.language ?? null,
        isbn13: pending.isbn13 ?? null,
        isbn10: pending.isbn10 ?? null,
        pageCount: pending.pageCount ?? null,
        googleBooksId: pending.googleBooksId ?? null,
        openLibraryId: pending.openLibraryId ?? null,
        goodreadsId: pending.goodreadsId ?? null,
        asin: pending.asin ?? null,
        goodreadsRating: pending.goodreadsRating ?? null,
      },
    });

    // Upsert authors
    for (const authorName of authors) {
      const trimmed = authorName?.trim();
      if (!trimmed) continue;
      const author = await this.prisma.author.upsert({
        where: { name: trimmed },
        update: {},
        create: { name: trimmed },
      });
      await this.prisma.bookAuthor.upsert({
        where: { bookId_authorId: { bookId: book.id, authorId: author.id } },
        update: {},
        create: { bookId: book.id, authorId: author.id },
      });
    }

    // Upsert series
    if (pending.seriesName) {
      const series = await this.prisma.series.upsert({
        where: { name: pending.seriesName },
        update: {
          ...(pending.seriesTotalBooks != null && {
            totalBooks: pending.seriesTotalBooks,
          }),
        },
        create: {
          name: pending.seriesName,
          totalBooks: pending.seriesTotalBooks ?? null,
        },
      });
      await this.prisma.seriesBook.upsert({
        where: { seriesId_bookId: { seriesId: series.id, bookId: book.id } },
        update: { sequence: pending.seriesPosition ?? null },
        create: {
          seriesId: series.id,
          bookId: book.id,
          sequence: pending.seriesPosition ?? null,
        },
      });
    }

    // Upsert genres
    const genres = JSON.parse(pending.genres) as string[];
    if (genres.length) {
      await this.prisma.book.update({
        where: { id: book.id },
        data: {
          genres: {
            connectOrCreate: genres.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });
    }

    // Upsert tags
    const tags = JSON.parse(pending.tags) as string[];
    if (tags.length) {
      await this.prisma.book.update({
        where: { id: book.id },
        data: {
          tags: {
            connectOrCreate: tags.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });
    }

    // Upsert moods
    const moods = JSON.parse(pending.moods) as string[];
    if (moods.length) {
      await this.prisma.book.update({
        where: { id: book.id },
        data: {
          moods: {
            connectOrCreate: moods.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });
    }

    const koReaderHash = computeKoReaderHash(targetPath);

    await this.prisma.bookFile.create({
      data: {
        bookId: book.id,
        filePath: targetPath,
        format,
        sizeBytes: BigInt(stat.size),
        fileHash: pending.fileHash,
        koReaderHash,
      },
    });

    // Extract and store cover
    await this.storeCover(targetPath, book.id, ext).catch(() => {});

    this.logger.log(`Library record created for book: ${book.id}`);
  }

  private async storeCover(
    filePath: string,
    bookId: string,
    ext: string,
  ): Promise<void> {
    if (ext === '.epub') {
      const epub = await EPub.createAsync(filePath);
      const coverId = epub.metadata.cover as string | undefined;
      if (!coverId) return;
      const [data] = await epub.getImageAsync(coverId);
      await this.prisma.book.update({
        where: { id: bookId },
        data: { coverData: new Uint8Array(data) },
      });
    } else if (['.mobi', '.azw', '.azw3'].includes(ext)) {
      const coverData = await extractMobiCover(filePath);
      if (!coverData) return;
      await this.prisma.book.update({
        where: { id: bookId },
        data: { coverData: coverData as unknown as Uint8Array<ArrayBuffer> },
      });
    } else if (ext === '.cbz') {
      const coverData = extractCbzCover(filePath);
      if (!coverData) return;
      await this.prisma.book.update({
        where: { id: bookId },
        data: { coverData: coverData as unknown as Uint8Array<ArrayBuffer> },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only probe (for settings API)
  // ---------------------------------------------------------------------------

  isVolumeReadOnly(): boolean {
    const libraryRoot = this.config.get<string>('ebookLibraryPath')!;
    return !this.diskWriteGuard.probeLibraryWritable(libraryRoot);
  }

  async extractMetadataFromFile(filePath: string) {
    try {
      return await extractFileMetadata(filePath);
    } catch {
      return {
        title: path.basename(filePath, path.extname(filePath)),
        authors: [] as string[],
      };
    }
  }
}
