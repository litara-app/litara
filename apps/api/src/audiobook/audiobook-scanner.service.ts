import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AudiobookMetadataService } from './audiobook-metadata.service';

const AUDIO_EXTENSIONS = ['.m4b', '.m4a', '.mp3'];
const M4B_EXTENSIONS = ['.m4b', '.m4a'];
const SINGLE_FILE_MIN_DURATION = 2700; // 45 minutes

interface AudioFileEntry {
  filePath: string;
  fileIndex: number;
  ext: string;
}

@Injectable()
export class AudiobookScannerService {
  private readonly logger = new Logger(AudiobookScannerService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly metadata: AudiobookMetadataService,
  ) {}

  async isAudiobookFolder(folderPath: string): Promise<boolean> {
    if (!fs.existsSync(folderPath)) return false;
    const stat = fs.statSync(folderPath);

    if (!stat.isDirectory()) {
      const ext = path.extname(folderPath).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) return false;
      return (
        (await this.metadata.getDuration(folderPath)) > SINGLE_FILE_MIN_DURATION
      );
    }

    const entries = fs.readdirSync(folderPath);
    const audioFiles = entries.filter((e) =>
      AUDIO_EXTENSIONS.includes(path.extname(e).toLowerCase()),
    );

    if (
      audioFiles.some((e) =>
        M4B_EXTENSIONS.includes(path.extname(e).toLowerCase()),
      )
    ) {
      return true;
    }

    const mp3Files = audioFiles.filter(
      (e) => path.extname(e).toLowerCase() === '.mp3',
    );
    if (mp3Files.length >= 3) return true;

    if (mp3Files.length === 1) {
      return (
        (await this.metadata.getDuration(path.join(folderPath, mp3Files[0]))) >
        SINGLE_FILE_MIN_DURATION
      );
    }

    return false;
  }

  async scanFolder(folderPath: string, libraryId?: string): Promise<void> {
    const resolvedPath = path.resolve(folderPath);
    const isSingleFile = fs.statSync(resolvedPath).isFile();
    const folder = isSingleFile ? path.dirname(resolvedPath) : resolvedPath;

    const audioFiles = this.collectAudioFiles(resolvedPath);
    if (audioFiles.length === 0) return;

    if (await this.isFolderUnchanged(audioFiles)) {
      return;
    }

    const firstFile = audioFiles[0];
    const rawMeta = await this.metadata.extractFromFile(firstFile.filePath);
    const absMeta = this.metadata.readAbsMetadata(folder);

    const title = rawMeta.title || this.metadata.deriveTitleFromFolder(folder);

    const authors = rawMeta.authors.length > 0 ? rawMeta.authors : [];
    const narrator = rawMeta.narrator || absMeta.narrator || null;

    const book = await this.upsertBook(
      {
        title,
        authors,
        coverData: rawMeta.coverData,
        publishedYear: rawMeta.publishedYear,
      },
      libraryId,
    );

    let totalDuration = 0;
    for (const entry of audioFiles) {
      const fileMeta =
        entry.filePath === firstFile.filePath
          ? rawMeta
          : await this.metadata.extractFromFile(entry.filePath, true);

      totalDuration += fileMeta.duration;

      const fileSize = BigInt(fs.statSync(entry.filePath).size);
      const fileHash = await this.computeHash(entry.filePath);
      const mimeType = entry.ext === '.mp3' ? 'audio/mpeg' : 'audio/mp4';

      const existing = await this.prisma.audiobookFile.findUnique({
        where: { filePath: entry.filePath },
      });

      let audiobookFileId: string;

      if (existing) {
        if (existing.fileHash !== fileHash || existing.fileSize === null) {
          await this.prisma.audiobookFile.update({
            where: { id: existing.id },
            data: {
              fileHash,
              fileSize,
              duration: fileMeta.duration,
              narrator,
              fileIndex: entry.fileIndex,
            },
          });
        }
        audiobookFileId = existing.id;
      } else {
        const created = await this.prisma.audiobookFile.create({
          data: {
            bookId: book.id,
            filePath: entry.filePath,
            fileHash,
            fileSize,
            fileIndex: entry.fileIndex,
            duration: fileMeta.duration,
            mimeType,
            narrator,
          },
        });
        audiobookFileId = created.id;

        await this.createChapters(
          audiobookFileId,
          entry.filePath,
          folder,
          fileMeta,
        );
      }
    }

    if (!book.hasAudiobook) {
      await this.prisma.book.update({
        where: { id: book.id },
        data: { hasAudiobook: true },
      });
    }

    this.logger.log(
      `Audiobook scanned: "${title}" (${audioFiles.length} file(s), ${Math.round(totalDuration / 60)} min)`,
    );
  }

  async handleFileRemoved(filePath: string): Promise<void> {
    const audiobookFile = await this.prisma.audiobookFile.findUnique({
      where: { filePath },
      include: { book: { include: { files: true, audiobookFiles: true } } },
    });
    if (!audiobookFile) return;

    await this.prisma.audiobookFile.delete({ where: { id: audiobookFile.id } });

    const book = audiobookFile.book;
    const remainingAudioFiles = book.audiobookFiles.filter(
      (f) => f.id !== audiobookFile.id,
    );
    const hasRemainingFiles =
      book.files.length > 0 || remainingAudioFiles.length > 0;

    if (!hasRemainingFiles) {
      await this.prisma.book.delete({ where: { id: book.id } });
      this.logger.log(`Deleted book (no remaining files): ${book.title}`);
    } else {
      const stillHasAudiobook = remainingAudioFiles.length > 0;
      await this.prisma.book.update({
        where: { id: book.id },
        data: { hasAudiobook: stillHasAudiobook },
      });
    }
  }

  isAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }

  private collectAudioFiles(folderPath: string): AudioFileEntry[] {
    const isSingleFile = fs.statSync(folderPath).isFile();

    if (isSingleFile) {
      const ext = path.extname(folderPath).toLowerCase();
      return [{ filePath: folderPath, fileIndex: 0, ext }];
    }

    const entries = fs.readdirSync(folderPath);
    const audioEntries = entries
      .filter((e) => AUDIO_EXTENSIONS.includes(path.extname(e).toLowerCase()))
      .map((e) => path.join(folderPath, e));

    const sorted = this.sortByNumericPrefix(audioEntries);
    return sorted.map((filePath, i) => ({
      filePath,
      fileIndex: i,
      ext: path.extname(filePath).toLowerCase(),
    }));
  }

  parseNumericPrefix(filename: string): number {
    const base = path.basename(filename);
    // Match leading digits optionally followed by space/dash/dot/underscore
    const match = /^(\d+)/.exec(base);
    return match ? parseInt(match[1], 10) : Infinity;
  }

  private sortByNumericPrefix(files: string[]): string[] {
    return [...files].sort((a, b) => {
      const na = this.parseNumericPrefix(a);
      const nb = this.parseNumericPrefix(b);
      if (na !== nb) return na - nb;
      return path.basename(a).localeCompare(path.basename(b));
    });
  }

  private async upsertBook(
    data: {
      title: string;
      authors: string[];
      coverData: Uint8Array | null;
      publishedYear: number | null;
    },
    libraryId?: string,
  ) {
    // Try to find existing book by title (simple match — no ISBN for audiobooks usually)
    const existing = await this.prisma.book.findFirst({
      where: { title: data.title },
    });

    if (existing) {
      if (!existing.coverData && data.coverData) {
        await this.prisma.book.update({
          where: { id: existing.id },
          data: { coverData: data.coverData as Uint8Array<ArrayBuffer> },
        });
      }
      return existing;
    }

    const publishedDate = data.publishedYear
      ? new Date(data.publishedYear, 0, 1)
      : null;

    const book = await this.prisma.book.create({
      data: {
        libraryId: libraryId ?? null,
        title: data.title,
        coverData: data.coverData as Uint8Array<ArrayBuffer> | null,
        publishedDate,
        hasAudiobook: true,
      },
    });

    for (const authorName of data.authors) {
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

    return book;
  }

  private async createChapters(
    audiobookFileId: string,
    filePath: string,
    folderPath: string,
    fileMeta: Awaited<ReturnType<AudiobookMetadataService['extractFromFile']>>,
  ) {
    let chapters = fileMeta.chapters;

    if (chapters.length === 0) {
      const cueChapters = this.loadCueChapters(folderPath, fileMeta.duration);
      if (cueChapters.length > 0) {
        chapters = cueChapters;
      }
    }

    if (chapters.length === 0) return;

    await this.prisma.audiobookChapter.createMany({
      data: chapters.map((ch) => ({
        audiobookFileId,
        index: ch.index,
        title: ch.title,
        startTime: ch.startTime,
        endTime: ch.endTime ?? null,
      })),
      skipDuplicates: true,
    });
  }

  private loadCueChapters(folderPath: string, totalDuration: number) {
    const entries = fs.readdirSync(folderPath);
    const cueFile = entries.find((e) => e.toLowerCase().endsWith('.cue'));
    if (!cueFile) return [];

    try {
      const content = fs.readFileSync(path.join(folderPath, cueFile), 'utf-8');
      return this.metadata.parseCueFile(content, totalDuration);
    } catch {
      return [];
    }
  }

  private async isFolderUnchanged(
    audioFiles: AudioFileEntry[],
  ): Promise<boolean> {
    const paths = audioFiles.map((f) => f.filePath);
    const records = await this.prisma.audiobookFile.findMany({
      where: { filePath: { in: paths } },
      select: { filePath: true, fileSize: true },
    });

    if (records.length !== audioFiles.length) return false;

    const sizeMap = new Map(records.map((r) => [r.filePath, r.fileSize]));
    for (const { filePath } of audioFiles) {
      const stored = sizeMap.get(filePath);
      if (stored === null || stored === undefined) return false;
      if (BigInt(fs.statSync(filePath).size) !== stored) return false;
    }
    return true;
  }

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
