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
import type { Library } from '@prisma/client';

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
  /** Map of libraryId → chokidar watcher */
  private readonly watchers = new Map<string, FSWatcher>();

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly metadataService: MetadataService,
    private readonly audiobookScanner: AudiobookScannerService,
  ) {}

  async onModuleInit() {
    const libraries = await this.prisma.library.findMany();
    for (const lib of libraries) {
      this.registerWatcher(lib);
    }
    if (libraries.length > 0) {
      void this.triggerFullScanTask();
    }
    void this.evaluateOrphans();
  }

  onModuleDestroy() {
    for (const watcher of this.watchers.values()) {
      void watcher.close();
    }
    this.watchers.clear();
  }

  // ---------------------------------------------------------------------------
  // Watcher registration (called from LibrariesService on create/delete)
  // ---------------------------------------------------------------------------

  registerWatcher(library: Library) {
    if (this.watchers.has(library.id)) return;

    const bookDropPath = this.config.get<string>('bookDropPath');
    const watcher = chokidar.watch(library.path, {
      ignored: bookDropPath ? [bookDropPath] : [],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    });

    watcher
      .on('add', (filePath: string) => {
        if (filePath.endsWith('.metadata.json')) {
          this.logger.log(`Sidecar detected: ${filePath}`);
          this.handleSidecarAdded(filePath).catch((err) =>
            this.logger.error(`Error processing sidecar ${filePath}`, err),
          );
        } else if (this.isSupportedFile(filePath)) {
          this.logger.log(`New file detected: ${filePath}`);
          this.handleFileAdded(filePath, false, library.id).catch((err) =>
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

    this.watchers.set(library.id, watcher);
    this.logger.log(`Watching library "${library.name}": ${library.path}`);
  }

  closeWatcher(libraryId: string) {
    const watcher = this.watchers.get(libraryId);
    if (watcher) {
      void watcher.close();
      this.watchers.delete(libraryId);
    }
  }

  // ---------------------------------------------------------------------------
  // Task-based full scan (iterates all libraries)
  // ---------------------------------------------------------------------------

  async triggerFullScanTask(
    rescanMetadata = false,
    libraryId?: string,
  ): Promise<{ taskId: string }> {
    const task = await this.prisma.task.create({
      data: {
        type: 'LIBRARY_SCAN',
        status: 'PENDING',
        payload: JSON.stringify({ processed: 0, total: 0, currentFile: '' }),
      },
    });
    void this.runFullScanTask(task.id, rescanMetadata, libraryId);
    return { taskId: task.id };
  }

  private async runFullScanTask(
    taskId: string,
    rescanMetadata: boolean,
    libraryId?: string,
  ): Promise<void> {
    try {
      await this.fullScan(rescanMetadata, taskId, libraryId);
      await this.prisma.task.updateMany({
        where: { id: taskId },
        data: { status: 'COMPLETED' },
      });
      void this.backfillKoReaderHashes();
    } catch (err) {
      await this.prisma.task.updateMany({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Per-library scan (creates its own Task)
  // ---------------------------------------------------------------------------

  async triggerLibraryScan(
    libraryId: string,
    opts: { rescanMetadata?: boolean } = {},
  ): Promise<{ taskId: string }> {
    const task = await this.prisma.task.create({
      data: {
        type: 'LIBRARY_SCAN',
        status: 'PENDING',
        payload: JSON.stringify({
          libraryId,
          processed: 0,
          total: 0,
          currentFile: '',
        }),
      },
    });
    void this.runLibraryScanTask(
      task.id,
      libraryId,
      opts.rescanMetadata ?? false,
    );
    return { taskId: task.id };
  }

  private async runLibraryScanTask(
    taskId: string,
    libraryId: string,
    rescanMetadata: boolean,
  ): Promise<void> {
    try {
      const library = await this.prisma.library.findUnique({
        where: { id: libraryId },
      });
      if (!library) {
        await this.prisma.task.updateMany({
          where: { id: taskId },
          data: { status: 'FAILED', errorMessage: 'Library not found' },
        });
        return;
      }

      await this.fullScan(rescanMetadata, taskId, library.id);

      await this.prisma.task.updateMany({
        where: { id: taskId },
        data: { status: 'COMPLETED' },
      });

      await this.prisma.library.update({
        where: { id: libraryId },
        data: { lastScanAt: new Date() },
      });

      void this.backfillKoReaderHashes();
    } catch (err) {
      await this.prisma.task.updateMany({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Full scan using fast-glob (iterates libraries or one library)
  // ---------------------------------------------------------------------------

  async fullScan(rescanMetadata = false, taskId?: string, libraryId?: string) {
    const where = libraryId ? { id: libraryId } : {};
    const libraries = await this.prisma.library.findMany({ where });

    if (libraries.length === 0) {
      this.logger.log('No libraries configured. Skipping scan.');
      return;
    }

    this.logger.log(
      `Starting full scan of ${libraries.length} library(s)...${rescanMetadata ? ' (rescan metadata)' : ''}`,
    );

    // Collect all files first so we can report an accurate total
    const allFiles: { filePath: string; library: Library }[] = [];
    // Track which paths were actually seen on disk, per library, so we can
    // reconcile (mark missing) DB rows that no longer resolve afterwards.
    const seenByLibrary = new Map<string, Set<string>>();
    for (const library of libraries) {
      const pattern = path.join(library.path, GLOB_PATTERN).replace(/\\/g, '/');
      const files = await glob.glob(pattern, { absolute: true, dot: false });
      this.logger.log(
        `Found ${files.length} file(s) in library "${library.name}"`,
      );
      const seen = new Set<string>();
      for (const f of files) {
        allFiles.push({ filePath: f, library });
        seen.add(f);
      }
      seenByLibrary.set(library.id, seen);
    }

    if (taskId) {
      await this.prisma.task.updateMany({
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
    for (const { filePath, library } of allFiles) {
      await this.handleFileAdded(filePath, rescanMetadata, library.id);
      processed++;
      if (taskId && (processed % 5 === 0 || processed === allFiles.length)) {
        await this.prisma.task.updateMany({
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

    if (taskId) {
      await this.prisma.task.updateMany({
        where: { id: taskId },
        data: {
          payload: JSON.stringify({
            processed: allFiles.length,
            total: allFiles.length,
            currentFile: 'Scanning audiobooks…',
          }),
        },
      });
    }

    for (const library of libraries) {
      await this.scanAudiobookFolders(library.path);
    }

    // Reconcile: mark any DB file rows in the scanned library(s) that were not
    // found on disk as missing, so stale paths (e.g. after a mount remap) stop
    // being treated as live and the hash backfill skips them.
    for (const library of libraries) {
      await this.reconcileMissingFiles(
        library.id,
        seenByLibrary.get(library.id) ?? new Set(),
      );
    }

    await this.prisma.library.updateMany({
      where: { id: { in: libraries.map((l) => l.id) } },
      data: { lastScanAt: new Date() },
    });

    this.logger.log('Full scan complete.');
  }

  // ---------------------------------------------------------------------------
  // Reconciliation pass (mark files missing when not found on disk)
  // ---------------------------------------------------------------------------

  /**
   * Marks BookFile rows belonging to a library as missing when they were not
   * seen during the scan and no longer exist on disk. Scoped per-library so a
   * single-library scan never touches files in other libraries; the full-scan
   * task simply calls this once per library it scanned.
   */
  private async reconcileMissingFiles(
    libraryId: string,
    seenPaths: Set<string>,
  ): Promise<void> {
    const candidates = await this.prisma.bookFile.findMany({
      where: { missingAt: null, book: { libraryId } },
      select: { id: true, filePath: true },
    });

    const nowMissing: string[] = [];
    for (const file of candidates) {
      // Seen on disk during this scan — definitely present.
      if (seenPaths.has(file.filePath)) continue;
      // Not seen by the glob; confirm absence before flagging (guards against
      // glob quirks, unsupported extensions, etc.).
      if (fs.existsSync(file.filePath)) continue;
      nowMissing.push(file.id);
    }

    if (nowMissing.length > 0) {
      await this.prisma.bookFile.updateMany({
        where: { id: { in: nowMissing } },
        data: { missingAt: new Date() },
      });
      this.logger.log(
        `Reconcile: marked ${nowMissing.length} file(s) missing in library ${libraryId}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Orphan evaluation pass
  // ---------------------------------------------------------------------------

  async evaluateOrphans(): Promise<void> {
    const libraries = await this.prisma.library.findMany({
      select: { id: true, path: true },
    });
    const books = await this.prisma.book.findMany({
      include: { files: { select: { filePath: true }, take: 1 } },
    });

    const groups = new Map<
      string,
      { ids: string[]; isOrphan: boolean; libraryId: string | null }
    >();

    for (const book of books) {
      const filePath = book.files[0]?.filePath;
      if (!filePath) continue;

      const matchedLibrary = this.findLibraryForPath(filePath, libraries);
      const isOrphan = !matchedLibrary;
      const libraryId = matchedLibrary?.id ?? null;

      if (book.isOrphan !== isOrphan || book.libraryId !== libraryId) {
        const key = `${isOrphan}:${libraryId}`;
        if (!groups.has(key)) groups.set(key, { ids: [], isOrphan, libraryId });
        groups.get(key)!.ids.push(book.id);
      }
    }

    for (const { ids, isOrphan, libraryId } of groups.values()) {
      await this.prisma.book.updateMany({
        where: { id: { in: ids } },
        data: { isOrphan, libraryId },
      });
    }

    this.logger.log('Orphan evaluation complete.');
  }

  /** Returns the library whose path is the longest prefix of filePath. */
  findLibraryForPath(
    filePath: string,
    libraries: Array<{ id: string; path: string }>,
  ): { id: string; path: string } | null {
    const normalized = path.normalize(filePath);
    let best: { id: string; path: string } | null = null;
    let bestLen = 0;

    for (const lib of libraries) {
      const libPath = path.normalize(lib.path) + path.sep;
      if (normalized.startsWith(libPath) && libPath.length > bestLen) {
        best = lib;
        bestLen = libPath.length;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Handle individual file addition
  // ---------------------------------------------------------------------------

  async handleFileAdded(
    filePath: string,
    rescanMetadata = false,
    knownLibraryId?: string,
  ) {
    try {
      const stat = fs.statSync(filePath);
      const sizeBytes = BigInt(stat.size);
      const hashes = await this.computeHash(filePath);
      const fileHash = hashes.sha256;
      const koReaderHash = hashes.md5;
      const format = path.extname(filePath).replace('.', '').toUpperCase();

      // Derive libraryId from path if not supplied
      let libraryId: string | null = knownLibraryId ?? null;
      let isOrphan = false;
      if (!libraryId) {
        const libraries = await this.prisma.library.findMany({
          select: { id: true, path: true },
        });
        const matched = this.findLibraryForPath(filePath, libraries);
        if (matched) {
          libraryId = matched.id;
        } else {
          isOrphan = true;
        }
      }

      // If a record exists for this path, handle re-scan/enrich on existing book
      const existingByPath = await this.prisma.bookFile.findFirst({
        where: { filePath },
      });
      if (existingByPath) {
        await this.prisma.bookFile.update({
          where: { id: existingByPath.id },
          data: { missingAt: null, fileHash, koReaderHash, sizeBytes },
        });
        // Update libraryId/isOrphan on the owning book if changed
        await this.prisma.book.updateMany({
          where: { id: existingByPath.bookId },
          data: { libraryId, isOrphan },
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
        // Relink when the content matches an existing row but the path differs
        // and the old path no longer resolves. This covers both chokidar-detected
        // moves (missingAt set) and mount remaps discovered on rescan (missingAt
        // still null because no unlink event ever fired). Requiring the old path
        // to be gone avoids hijacking a genuinely-present duplicate's row.
        const pathChanged = existingFile.filePath !== filePath;
        const oldPathGone =
          pathChanged && !fs.existsSync(existingFile.filePath);
        if (existingFile.missingAt !== null || oldPathGone) {
          await this.prisma.bookFile.update({
            where: { id: existingFile.id },
            data: { filePath, missingAt: null, koReaderHash, sizeBytes },
          });
          await this.prisma.book.updateMany({
            where: { id: existingFile.bookId },
            data: { libraryId, isOrphan },
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

      // Create Book
      const book = await this.prisma.book.create({
        data: {
          libraryId,
          isOrphan,
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
    const normSidecar = sidecarPath.replace(/\\/g, '/');
    const dir = path.dirname(normSidecar);
    const sidecarBase = path
      .basename(normSidecar, '.metadata.json')
      .toLowerCase();

    const alreadyLinked = await this.prisma.book.findFirst({
      where: { sidecarFile: { in: [sidecarPath, normSidecar] } },
      select: { id: true },
    });
    if (alreadyLinked) return;

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

  private isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return SUPPORTED_FORMATS.includes(ext);
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
    const epub = (await EPub.createAsync(filePath)) as unknown as EPub;
    const coverId = epub.metadata.cover as string | undefined;
    if (!coverId) return;
    const [data] = (await epub.getImageAsync(coverId)) as [Buffer, string];
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
    skipped: number;
  }> {
    const files = await this.prisma.bookFile.findMany({
      where: { missingAt: null },
      select: { id: true, filePath: true },
    });
    if (files.length === 0) {
      this.logger.log('KOReader hash backfill: all files already have hashes.');
      return { total: 0, done: 0, failed: 0, skipped: 0 };
    }
    this.logger.log(
      `KOReader hash backfill: ${files.length} file(s) need MD5 hashes...`,
    );
    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const file of files) {
      // Self-heal stale rows: a path that no longer resolves (e.g. after a
      // mount remap) shouldn't be hashed or warned about — mark it missing so
      // the reconcile/move-detection logic can re-link it on the next scan.
      if (!fs.existsSync(file.filePath)) {
        await this.prisma.bookFile.update({
          where: { id: file.id },
          data: { missingAt: new Date() },
        });
        skipped++;
        continue;
      }
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
      `KOReader hash backfill complete: ${done} hashed, ${failed} failed, ${skipped} marked missing, ${files.length} total`,
    );
    return { total: files.length, done, failed, skipped };
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
        return;
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dirPath, entry.name));
        } else {
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
