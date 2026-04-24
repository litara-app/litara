import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { MetadataService } from '../metadata/metadata.service';
import * as glob from 'fast-glob';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { computeKoReaderHash } from '../common/koreader-hash';
import { EPub } from 'epub2';
import { extractMobiCover } from '@litara/mobi-parser';
import { extractCbzCover } from '@litara/cbz-parser';
import { extractFileMetadata } from '../common/extract-file-metadata';
import { findSidecar } from '../common/find-sidecar';
import { AudiobookScannerService } from '../audiobook/audiobook-scanner.service';
import type { FSWatcher } from 'chokidar';

const SUPPORTED_FORMATS = [
  'epub',
  'mobi',
  'azw',
  'azw3',
  'cbz',
  'pdf',
  'fb2',
  'cbr',
  'cb7',
];
const GLOB_PATTERN = `**/*.{${SUPPORTED_FORMATS.join(',')}}`;

@Injectable()
export class LibraryScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LibraryScannerService.name);
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly metadataService: MetadataService,
    private readonly audiobookScanner: AudiobookScannerService,
  ) {}

  async onModuleInit() {
    await this.ensureWatchedFolder();
    void this.triggerFullScanTask();
    void this.startWatching();
  }

  onModuleDestroy() {
    if (this.watcher) {
      void this.watcher.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Seeding: ensure a WatchedFolder exists
  // ---------------------------------------------------------------------------

  private async ensureWatchedFolder() {
    const ebookLibraryPath = this.config.get<string>('ebookLibraryPath')!;

    if (fs.existsSync(ebookLibraryPath)) {
      const existing = await this.prisma.watchedFolder.findUnique({
        where: { path: ebookLibraryPath },
      });
      if (!existing) {
        await this.prisma.watchedFolder.create({
          data: { path: ebookLibraryPath, isActive: true },
        });
        this.logger.log(`Registered watched folder: ${ebookLibraryPath}`);
      }
    } else {
      this.logger.warn(
        `Ebook library folder not found at "${ebookLibraryPath}". Set EBOOK_LIBRARY_PATH to override. Skipping default seed.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Task-based full scan (non-blocking, reports progress)
  // ---------------------------------------------------------------------------

  async triggerFullScanTask(
    rescanMetadata = false,
  ): Promise<{ taskId: string }> {
    const task = await this.prisma.task.create({
      data: {
        type: 'LIBRARY_SCAN',
        status: 'PENDING',
        payload: JSON.stringify({ processed: 0, total: 0, currentFile: '' }),
      },
    });
    void this.runFullScanTask(task.id, rescanMetadata);
    return { taskId: task.id };
  }

  private async runFullScanTask(
    taskId: string,
    rescanMetadata: boolean,
  ): Promise<void> {
    try {
      await this.fullScan(rescanMetadata, taskId);
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'COMPLETED' },
      });
      void this.backfillKoReaderHashes();
    } catch (err) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Full scan using fast-glob
  // ---------------------------------------------------------------------------

  async fullScan(rescanMetadata = false, taskId?: string) {
    const watchedFolders = await this.prisma.watchedFolder.findMany({
      where: { isActive: true },
    });

    if (watchedFolders.length === 0) {
      this.logger.log('No active watched folders configured. Skipping scan.');
      return;
    }

    this.logger.log(
      `Starting full scan of ${watchedFolders.length} folder(s)...${rescanMetadata ? ' (rescan metadata)' : ''}`,
    );

    // Collect all ebook files first so we can report an accurate total
    const allFiles: string[] = [];
    for (const folder of watchedFolders) {
      const pattern = path.join(folder.path, GLOB_PATTERN).replace(/\\/g, '/');
      const files = await glob.glob(pattern, { absolute: true, dot: false });
      this.logger.log(`Found ${files.length} file(s) in ${folder.path}`);
      allFiles.push(...files);
    }

    if (taskId) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'PROCESSING',
          payload: JSON.stringify({
            processed: 0,
            total: allFiles.length,
            currentFile: '',
          }),
        },
      });
    }

    let processed = 0;
    for (const filePath of allFiles) {
      await this.handleFileAdded(filePath, rescanMetadata);
      processed++;
      if (taskId && (processed % 5 === 0 || processed === allFiles.length)) {
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            payload: JSON.stringify({
              processed,
              total: allFiles.length,
              currentFile: path.basename(filePath),
            }),
          },
        });
      }
    }

    for (const folder of watchedFolders) {
      await this.scanAudiobookFolders(folder.path);
    }

    this.logger.log('Full scan complete.');
  }

  // ---------------------------------------------------------------------------
  // Continuous watching using chokidar
  // ---------------------------------------------------------------------------

  private async startWatching() {
    const watchedFolders = await this.prisma.watchedFolder.findMany({
      where: { isActive: true },
    });

    if (watchedFolders.length === 0) return;

    const bookDropPath = this.config.get<string>('bookDropPath');
    const paths = watchedFolders.map((f) => f.path);
    this.logger.log(`Watching ${paths.length} folder(s) for changes...`);

    this.watcher = chokidar.watch(paths, {
      ignored: bookDropPath ? [bookDropPath] : [],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    });

    this.watcher
      .on('add', (filePath: string) => {
        if (filePath.endsWith('.metadata.json')) {
          this.logger.log(`Sidecar detected: ${filePath}`);
          this.handleSidecarAdded(filePath).catch((err) =>
            this.logger.error(`Error processing sidecar ${filePath}`, err),
          );
        } else if (this.isSupportedFile(filePath)) {
          this.logger.log(`New file detected: ${filePath}`);
          this.handleFileAdded(filePath).catch((err) =>
            this.logger.error(`Error adding file ${filePath}`, err),
          );
        } else if (this.audiobookScanner.isAudioFile(filePath)) {
          this.logger.log(`New audio file detected: ${filePath}`);
          (async () => {
            const folder = path.dirname(filePath);
            if (await this.audiobookScanner.isAudiobookFolder(folder)) {
              await this.audiobookScanner.scanFolder(folder);
            } else if (
              await this.audiobookScanner.isAudiobookFolder(filePath)
            ) {
              await this.audiobookScanner.scanFolder(filePath);
            }
          })().catch((err) =>
            this.logger.error(`Error processing audio file ${filePath}`, err),
          );
        }
      })
      .on('unlink', (filePath: string) => {
        if (this.isSupportedFile(filePath)) {
          this.logger.log(`File removed: ${filePath}`);
          this.handleFileRemoved(filePath).catch((err) =>
            this.logger.error(`Error removing file ${filePath}`, err),
          );
        } else if (this.audiobookScanner.isAudioFile(filePath)) {
          this.logger.log(`Audio file removed: ${filePath}`);
          this.audiobookScanner
            .handleFileRemoved(filePath)
            .catch((err) =>
              this.logger.error(`Error removing audio file ${filePath}`, err),
            );
        }
      });
  }

  private isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return SUPPORTED_FORMATS.includes(ext);
  }

  // ---------------------------------------------------------------------------
  // Handle individual file addition
  // ---------------------------------------------------------------------------

  async handleFileAdded(filePath: string, rescanMetadata = false) {
    try {
      const stat = fs.statSync(filePath);
      const sizeBytes = BigInt(stat.size);
      const hashes = await this.computeHash(filePath);
      const fileHash = hashes.sha256;
      const koReaderHash = hashes.md5;
      const format = path.extname(filePath).replace('.', '').toUpperCase();

      // If a record exists for this path, handle re-scan/enrich on existing book
      const existingByPath = await this.prisma.bookFile.findFirst({
        where: { filePath },
      });
      if (existingByPath) {
        await this.prisma.bookFile.update({
          where: { id: existingByPath.id },
          data: { missingAt: null, fileHash, koReaderHash, sizeBytes },
        });
        this.logger.log(`File re-appeared, cleared missing flag: ${filePath}`);

        if (rescanMetadata) {
          await this.rescanBookMetadata(filePath, existingByPath.bookId);
        }

        return;
      }

      // Check if file hash already exists
      const existingFile = await this.prisma.bookFile.findFirst({
        where: { fileHash },
      });
      if (existingFile) {
        if (existingFile.missingAt !== null) {
          // File moved to a new location — update path and clear missing flag
          await this.prisma.bookFile.update({
            where: { id: existingFile.id },
            data: { filePath, missingAt: null, koReaderHash, sizeBytes },
          });
          this.logger.log(
            `File moved, updated path and cleared missing flag: ${filePath}`,
          );
        }
        return;
      }

      // Extract metadata
      const metadata = await this.extractMetadata(filePath);
      this.logger.debug(
        `Metadata for ${path.basename(filePath)}: title="${metadata.title}" authors=[${metadata.authors.join(', ')}]`,
      );

      // Create Book (libraryId is null — user assigns books to libraries explicitly)
      const book = await this.prisma.book.create({
        data: {
          libraryId: null,
          title:
            metadata.title || path.basename(filePath, path.extname(filePath)),
          description: metadata.description || null,
          publishedDate: metadata.publishedDate || null,
        },
      });

      // Upsert Authors
      for (const authorName of metadata.authors) {
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

      // Create BookFile
      await this.prisma.bookFile.create({
        data: {
          bookId: book.id,
          filePath: filePath,
          format,
          sizeBytes,
          fileHash,
          koReaderHash,
        },
      });

      // Detect sidecar
      const sidecarPath = findSidecar(filePath, book.title);
      if (sidecarPath) {
        await this.prisma.book.update({
          where: { id: book.id },
          data: { sidecarFile: sidecarPath },
        });
        this.logger.log(`Sidecar linked: ${sidecarPath}`);
      }

      // Extract and store cover image
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.epub') {
        await this.storeCoverFromEpub(filePath, book.id).catch(() => {});
      } else if (['.mobi', '.azw', '.azw3'].includes(ext)) {
        await this.storeCoverFromMobi(filePath, book.id).catch(() => {});
      } else if (ext === '.cbz') {
        await this.storeCoverFromCbz(filePath, book.id).catch(() => {});
      }

      this.logger.log(
        `Imported: "${metadata.title}" [${format}] — ${metadata.authors.join(', ') || 'Unknown author'}`,
      );
    } catch (err) {
      this.logger.error(`Failed to process file: ${filePath}`, err);
    }
  }

  private async handleSidecarAdded(sidecarPath: string): Promise<void> {
    // Normalise to forward slashes so comparisons work on Windows regardless
    // of whether chokidar or the DB stored paths with backslashes.
    const normSidecar = sidecarPath.replace(/\\/g, '/');
    const dir = path.dirname(normSidecar);
    const sidecarBase = path
      .basename(normSidecar, '.metadata.json')
      .toLowerCase();

    // Skip silently if a book already has this exact sidecar linked —
    // writeSidecar() updates Book.sidecarFile before chokidar fires.
    const alreadyLinked = await this.prisma.book.findFirst({
      where: { sidecarFile: { in: [sidecarPath, normSidecar] } },
      select: { id: true },
    });
    if (alreadyLinked) return;

    // Find a book whose file lives in the same directory with a matching base name.
    // Fetch all BookFiles and filter in-process to avoid path-separator issues
    // with Prisma's startsWith on Windows.
    const candidates = await this.prisma.bookFile.findMany({
      include: { book: true },
    });

    const normalizedDir = dir.replace(/\\/g, '/');

    for (const bf of candidates) {
      const normFilePath = bf.filePath.replace(/\\/g, '/');
      if (!normFilePath.startsWith(normalizedDir + '/')) continue;

      const fileBase = path
        .basename(normFilePath, path.extname(normFilePath))
        .toLowerCase();
      if (fileBase === sidecarBase) {
        await this.prisma.book.update({
          where: { id: bf.bookId },
          data: { sidecarFile: sidecarPath },
        });
        this.logger.log(
          `Sidecar linked to book "${bf.book.title}": ${sidecarPath}`,
        );
        return;
      }
    }

    this.logger.debug(
      `Sidecar added but no matching book found: ${sidecarPath}`,
    );
  }

  async handleFileRemoved(filePath: string) {
    try {
      const bookFile = await this.prisma.bookFile.findFirst({
        where: { filePath },
      });
      if (bookFile) {
        await this.prisma.bookFile.update({
          where: { id: bookFile.id },
          data: { missingAt: new Date() },
        });
        this.logger.log(`Marked BookFile as missing: ${filePath}`);
      }
    } catch (err) {
      this.logger.error(`Failed to mark file as missing: ${filePath}`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Metadata extraction
  // ---------------------------------------------------------------------------

  private async extractMetadata(filePath: string) {
    try {
      return await extractFileMetadata(filePath, (msg) =>
        this.logger.debug(msg),
      );
    } catch (err) {
      this.logger.warn(
        `Could not parse metadata for ${filePath}: ${(err as Error).message}`,
      );
      return {
        title: path.basename(filePath, path.extname(filePath)),
        authors: [] as string[],
      };
    }
  }

  private async rescanBookMetadata(
    filePath: string,
    bookId: string,
  ): Promise<void> {
    this.logger.log(`Re-scanning metadata from file: ${filePath}`);
    const metadata = await this.extractMetadata(filePath);

    await this.prisma.book.update({
      where: { id: bookId },
      data: {
        title:
          metadata.title || path.basename(filePath, path.extname(filePath)),
        description: metadata.description ?? null,
        publishedDate: metadata.publishedDate ?? null,
      },
    });

    for (const authorName of metadata.authors) {
      const trimmed = authorName?.trim();
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

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.epub') {
      await this.storeCoverFromEpub(filePath, bookId).catch(() => {});
    } else if (['.mobi', '.azw', '.azw3'].includes(ext)) {
      await this.storeCoverFromMobi(filePath, bookId).catch(() => {});
    }

    this.logger.log(`Re-scan complete for: ${filePath}`);
  }

  private async storeCoverFromEpub(
    filePath: string,
    bookId: string,
  ): Promise<void> {
    const epub = await EPub.createAsync(filePath);
    // cover is typed as `any` in IMetadata — one cast to usable type
    const coverId = epub.metadata.cover as string | undefined;
    if (!coverId) return;
    const [data] = await epub.getImageAsync(coverId);
    await this.prisma.book.update({
      where: { id: bookId },
      data: { coverData: new Uint8Array(data) },
    });
  }

  private async storeCoverFromMobi(
    filePath: string,
    bookId: string,
  ): Promise<void> {
    this.logger.log(`Extracting cover from mobi: ${filePath}`);
    const coverData = await extractMobiCover(filePath);
    if (!coverData) {
      this.logger.warn(`No cover image found in mobi file: ${filePath}`);
      return;
    }
    this.logger.log(
      `Cover extracted (${coverData.byteLength} bytes), saving for book ${bookId}`,
    );
    await this.prisma.book.update({
      where: { id: bookId },
      data: { coverData: coverData as unknown as Uint8Array<ArrayBuffer> },
    });
  }

  private async storeCoverFromCbz(
    filePath: string,
    bookId: string,
  ): Promise<void> {
    this.logger.debug(`Extracting cover from CBZ: ${filePath}`);
    const coverData = extractCbzCover(filePath);
    if (!coverData) {
      this.logger.warn(`No cover image found in CBZ file: ${filePath}`);
      return;
    }
    this.logger.debug(
      `Cover extracted (${coverData.byteLength} bytes), saving for book ${bookId}`,
    );
    await this.prisma.book.update({
      where: { id: bookId },
      data: { coverData: coverData as unknown as Uint8Array<ArrayBuffer> },
    });
  }

  // ---------------------------------------------------------------------------
  // KOReader hash backfill
  // ---------------------------------------------------------------------------

  async backfillKoReaderHashes(): Promise<{
    total: number;
    done: number;
    failed: number;
  }> {
    const files = await this.prisma.bookFile.findMany({
      where: { missingAt: null },
      select: { id: true, filePath: true },
    });
    if (files.length === 0) {
      this.logger.log('KOReader hash backfill: all files already have hashes.');
      return { total: 0, done: 0, failed: 0 };
    }
    this.logger.log(
      `KOReader hash backfill: ${files.length} file(s) need MD5 hashes...`,
    );
    let done = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const hashes = await this.computeHash(file.filePath);
        await this.prisma.bookFile.update({
          where: { id: file.id },
          data: { koReaderHash: hashes.md5 },
        });
        done++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `KOReader hash backfill: failed for "${file.filePath}" — ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `KOReader hash backfill complete: ${done} hashed, ${failed} failed, ${files.length} total`,
    );
    return { total: files.length, done, failed };
  }

  // ---------------------------------------------------------------------------
  // Audiobook folder scanning
  // ---------------------------------------------------------------------------

  private async scanAudiobookFolders(rootPath: string): Promise<void> {
    if (!fs.existsSync(rootPath)) return;

    const walk = async (dirPath: string) => {
      const isAudiobook =
        await this.audiobookScanner.isAudiobookFolder(dirPath);
      if (isAudiobook) {
        await this.audiobookScanner.scanFolder(dirPath);
        return; // don't recurse into audiobook folder
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dirPath, entry.name));
        } else {
          // Single large audio file in root
          const ext = path.extname(entry.name).toLowerCase();
          if (['.mp3', '.m4a'].includes(ext)) {
            const filePath = path.join(dirPath, entry.name);
            const isSingleAudiobook =
              await this.audiobookScanner.isAudiobookFolder(filePath);
            if (isSingleAudiobook) {
              await this.audiobookScanner.scanFolder(filePath);
            }
          }
        }
      }
    };

    await walk(rootPath);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private computeHash(
    filePath: string,
  ): Promise<{ sha256: string; md5: string }> {
    return new Promise((resolve, reject) => {
      const sha256 = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => sha256.update(chunk));
      stream.on('end', () => {
        try {
          const md5 = computeKoReaderHash(filePath);
          resolve({ sha256: sha256.digest('hex'), md5 });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      stream.on('error', reject);
    });
  }
}
