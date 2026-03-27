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
import { EPub } from 'epub2';
import { extractMobiCover } from '@litara/mobi-parser';
import { extractCbzCover } from '@litara/cbz-parser';
import { extractFileMetadata } from '../common/extract-file-metadata';
import { findSidecar } from '../common/find-sidecar';
import type { FSWatcher } from 'chokidar';

const SUPPORTED_FORMATS = ['epub', 'mobi', 'azw', 'azw3', 'cbz', 'pdf'];
const GLOB_PATTERN = `**/*.{${SUPPORTED_FORMATS.join(',')}}`;

@Injectable()
export class LibraryScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LibraryScannerService.name);
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly config: ConfigService,
    private readonly metadataService: MetadataService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultLibraryAndFolder();
    await this.fullScan();
    void this.startWatching();
  }

  onModuleDestroy() {
    if (this.watcher) {
      void this.watcher.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Seeding: ensure a default Library and WatchedFolder exist
  // ---------------------------------------------------------------------------

  private async ensureDefaultLibraryAndFolder() {
    // Ensure a "Default Library" exists
    let library = await this.prisma.library.findFirst({
      where: { name: 'Default Library' },
    });
    if (!library) {
      library = await this.prisma.library.create({
        data: {
          name: 'Default Library',
          description: 'Auto-created default library',
        },
      });
      this.logger.log('Created Default Library');
    }

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
  // Full scan using fast-glob
  // ---------------------------------------------------------------------------

  async fullScan(rescanMetadata = false) {
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

    for (const folder of watchedFolders) {
      const pattern = path.join(folder.path, GLOB_PATTERN).replace(/\\/g, '/');
      const files = await glob.glob(pattern, { absolute: true, dot: false });
      this.logger.log(`Found ${files.length} file(s) in ${folder.path}`);
      for (const filePath of files) {
        await this.handleFileAdded(filePath, rescanMetadata);
      }
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

    const paths = watchedFolders.map((f) => f.path);
    this.logger.log(`Watching ${paths.length} folder(s) for changes...`);

    this.watcher = chokidar.watch(paths, {
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
        }
      })
      .on('unlink', (filePath: string) => {
        if (this.isSupportedFile(filePath)) {
          this.logger.log(`File removed: ${filePath}`);
          this.handleFileRemoved(filePath).catch((err) =>
            this.logger.error(`Error removing file ${filePath}`, err),
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
      const fileHash = await this.computeHash(filePath);
      const format = path.extname(filePath).replace('.', '').toUpperCase();

      // If a record exists for this path, handle re-scan/enrich on existing book
      const existingByPath = await this.prisma.bookFile.findFirst({
        where: { filePath },
      });
      if (existingByPath) {
        await this.prisma.bookFile.update({
          where: { id: existingByPath.id },
          data: { missingAt: null, fileHash, sizeBytes },
        });
        this.logger.log(`File re-appeared, cleared missing flag: ${filePath}`);

        if (rescanMetadata) {
          await this.rescanBookMetadata(filePath, existingByPath.bookId);
        }

        return;
      }

      // Skip if file hash already exists (exact duplicate)
      const existingFile = await this.prisma.bookFile.findFirst({
        where: { fileHash },
      });
      if (existingFile) {
        return;
      }

      // Extract metadata
      const metadata = await this.extractMetadata(filePath);
      this.logger.debug(
        `Metadata for ${path.basename(filePath)}: title="${metadata.title}" authors=[${metadata.authors.join(', ')}]`,
      );

      // Find or create a Library
      const library = await this.prisma.library.findFirst({
        where: { name: 'Default Library' },
      });
      if (!library) return;

      // Create Book
      const book = await this.prisma.book.create({
        data: {
          libraryId: library.id,
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
    const dir = path.dirname(sidecarPath);
    const sidecarBase = path
      .basename(sidecarPath, '.metadata.json')
      .toLowerCase();

    // Find a book whose file lives in the same directory with a matching base name
    const candidates = await this.prisma.bookFile.findMany({
      where: { filePath: { startsWith: dir } },
      include: { book: true },
    });

    for (const bf of candidates) {
      const fileBase = path
        .basename(bf.filePath, path.extname(bf.filePath))
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

    this.logger.log(`Sidecar added but no matching book found: ${sidecarPath}`);
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
