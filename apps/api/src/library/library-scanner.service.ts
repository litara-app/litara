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
import { extractMobiMetadata } from '@litara/mobi-parser';
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

  async fullScan(forceEnrich = false) {
    const watchedFolders = await this.prisma.watchedFolder.findMany({
      where: { isActive: true },
    });

    if (watchedFolders.length === 0) {
      this.logger.log('No active watched folders configured. Skipping scan.');
      return;
    }

    this.logger.log(
      `Starting full scan of ${watchedFolders.length} folder(s)...${forceEnrich ? ' (with metadata enrichment)' : ''}`,
    );

    for (const folder of watchedFolders) {
      const pattern = path.join(folder.path, GLOB_PATTERN).replace(/\\/g, '/');
      const files = await glob.glob(pattern, { absolute: true, dot: false });
      this.logger.log(`Found ${files.length} file(s) in ${folder.path}`);
      for (const filePath of files) {
        await this.handleFileAdded(filePath, forceEnrich);
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
        if (this.isSupportedFile(filePath)) {
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

  async handleFileAdded(filePath: string, forceEnrich = false) {
    try {
      const stat = fs.statSync(filePath);
      const sizeBytes = BigInt(stat.size);
      const fileHash = await this.computeHash(filePath);
      const format = path.extname(filePath).replace('.', '').toUpperCase();

      // If a record exists for this path (previously marked missing), un-mark it
      const existingByPath = await this.prisma.bookFile.findFirst({
        where: { filePath },
      });
      if (existingByPath) {
        await this.prisma.bookFile.update({
          where: { id: existingByPath.id },
          data: { missingAt: null, fileHash, sizeBytes },
        });
        this.logger.log(`File re-appeared, cleared missing flag: ${filePath}`);
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

      // Extract and store cover image for EPUB files
      if (path.extname(filePath).toLowerCase() === '.epub') {
        await this.storeCoverFromEpub(filePath, book.id).catch(() => {});
      }

      this.logger.log(
        `Imported: "${metadata.title}" [${format}] — ${metadata.authors.join(', ') || 'Unknown author'}`,
      );

      // Fire-and-forget metadata enrichment — if explicitly enabled via env var or forced by caller
      if (
        forceEnrich ||
        this.config.get<string>('METADATA_ENRICH_ON_SCAN') === 'true'
      ) {
        this.metadataService
          .enrichBook(book.id, {
            title:
              metadata.title || path.basename(filePath, path.extname(filePath)),
            authors: metadata.authors,
            isbn: metadata.isbn,
          })
          .catch((err) =>
            this.logger.warn(
              `Metadata enrichment failed for "${metadata.title}": ${(err as Error).message}`,
            ),
          );
      }
    } catch (err) {
      this.logger.error(`Failed to process file: ${filePath}`, err);
    }
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

  private async extractMetadata(filePath: string): Promise<{
    title: string;
    authors: string[];
    description?: string;
    publishedDate?: Date;
    isbn?: string;
  }> {
    const ext = path.extname(filePath).toLowerCase();

    try {
      if (ext === '.epub') {
        return await this.extractEpubMetadata(filePath);
      }
      if (['.mobi', '.azw', '.azw3'].includes(ext)) {
        return await extractMobiMetadata(filePath);
      }
      // CBZ/PDF: fall back to filename-based metadata
    } catch (err) {
      this.logger.warn(
        `Could not parse metadata for ${filePath}: ${(err as Error).message}`,
      );
    }

    return {
      title: path.basename(filePath, path.extname(filePath)),
      authors: [],
    };
  }

  private async extractEpubMetadata(filePath: string): Promise<{
    title: string;
    authors: string[];
    description?: string;
    publishedDate?: Date;
    isbn?: string;
  }> {
    const epub = await EPub.createAsync(filePath);
    const meta = epub.metadata;

    // epub2 exposes creator as a string (may be comma-separated or semicolon-separated)
    const rawCreator = meta.creator ?? '';
    const authors = rawCreator
      ? rawCreator
          .split(/[,;]/)
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

    let publishedDate: Date | undefined;
    if (meta.date) {
      const d = new Date(meta.date);
      if (!isNaN(d.getTime())) publishedDate = d;
    }

    // epub2 stores identifier (ISBN or other ID) under meta['identifier'] via the index signature
    const rawIdentifier = String(meta['identifier'] ?? '');
    const isbn = rawIdentifier.replace(/^urn:isbn:/i, '').trim() || undefined;

    return {
      title: meta.title ?? '',
      authors,
      description: meta.description ?? undefined,
      publishedDate,
      isbn,
    };
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
