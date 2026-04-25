import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { IAudioMetadata } from 'music-metadata';

interface ChapterMeta {
  index: number;
  title: string;
  startTime: number;
  endTime?: number;
}

interface ExtractedAudioMeta {
  title: string | null;
  authors: string[];
  narrator: string | null;
  duration: number;
  coverData: Uint8Array | null;
  publishedYear: number | null;
  chapters: ChapterMeta[];
}

interface AbsMetadata {
  narrator?: string;
  title?: string;
  authors?: string[];
}

@Injectable()
export class AudiobookMetadataService {
  private readonly logger = new Logger(AudiobookMetadataService.name);
  private mmModuleCache: Promise<typeof import('music-metadata')> | null = null;

  private get mmModule(): Promise<typeof import('music-metadata')> {
    this.mmModuleCache ??= import('music-metadata');
    return this.mmModuleCache;
  }

  async extractFromFile(
    filePath: string,
    skipCovers = false,
  ): Promise<ExtractedAudioMeta> {
    let meta: IAudioMetadata;
    try {
      const mm = await this.mmModule;
      meta = await mm.parseFile(filePath, {
        duration: true,
        skipCovers,
      });
    } catch (err) {
      this.logger.warn(`music-metadata failed for ${filePath}: ${String(err)}`);
      return this.emptyMeta();
    }

    const { common, format } = meta;

    const title = common.album ?? common.title ?? null;
    const authors = this.extractAuthors(common);
    const narrator = this.extractNarrator(common);
    const duration = format.duration ?? 0;
    const coverData = common.picture?.[0]?.data ?? null;
    const publishedYear = common.year ?? null;
    const chapters = this.extractEmbeddedChapters(meta);

    return {
      title,
      authors,
      narrator,
      duration,
      coverData,
      publishedYear,
      chapters,
    };
  }

  private extractAuthors(common: {
    artist?: string;
    albumartist?: string;
  }): string[] {
    if (common.artist) return [common.artist];
    if (common.albumartist) return [common.albumartist];
    return [];
  }

  private extractNarrator(common: { composer?: string[] }): string | null {
    if (common.composer?.[0]) return common.composer[0];
    return null;
  }

  private extractEmbeddedChapters(meta: IAudioMetadata): ChapterMeta[] {
    const rawChapters = (
      meta as { chapter?: Array<{ title: string; startTimeInSeconds: number }> }
    ).chapter;
    if (!rawChapters?.length) return [];

    return rawChapters.map((ch, i) => ({
      index: i,
      title: ch.title || `Chapter ${i + 1}`,
      startTime: ch.startTimeInSeconds,
      endTime: rawChapters[i + 1]?.startTimeInSeconds,
    }));
  }

  parseCueFile(cueContent: string, totalDuration: number): ChapterMeta[] {
    const lines = cueContent.split(/\r?\n/);
    const chapters: ChapterMeta[] = [];
    let currentTitle: string | null = null;
    let trackIndex = 0;

    for (const line of lines) {
      const titleMatch = /^\s*TITLE\s+"(.+)"/.exec(line);
      const indexMatch = /^\s*INDEX\s+01\s+(\d+):(\d+):(\d+)/.exec(line);
      const trackMatch = /^\s*TRACK\s+(\d+)\s+AUDIO/.exec(line);

      if (trackMatch) {
        trackIndex = parseInt(trackMatch[1], 10) - 1;
      } else if (titleMatch && trackIndex >= 0 && chapters.length > 0) {
        currentTitle = titleMatch[1];
      } else if (titleMatch) {
        currentTitle = titleMatch[1];
      } else if (indexMatch && currentTitle !== null) {
        const m = parseInt(indexMatch[1], 10);
        const s = parseInt(indexMatch[2], 10);
        const f = parseInt(indexMatch[3], 10);
        const startTime = m * 60 + s + f / 75;

        if (chapters.length > 0) {
          chapters[chapters.length - 1].endTime = startTime;
        }

        chapters.push({
          index: chapters.length,
          title: currentTitle,
          startTime,
          endTime: undefined,
        });
        currentTitle = null;
      }
    }

    if (chapters.length > 0) {
      chapters[chapters.length - 1].endTime = totalDuration;
    }

    return chapters;
  }

  deriveTitleFromFolder(folderPath: string): string {
    const name = path.basename(folderPath);
    return (
      name
        .replace(/^\d+\s*[-._]\s*/, '')
        .replace(/\s*-?\s*Unabridged$/i, '')
        .replace(/\s*-?\s*Audiobook$/i, '')
        .trim() || name
    );
  }

  readAbsMetadata(folderPath: string): AbsMetadata {
    const metaPath = path.join(folderPath, 'metadata.json');
    if (!fs.existsSync(metaPath)) return {};
    try {
      const raw = fs.readFileSync(metaPath, 'utf-8');
      return JSON.parse(raw) as AbsMetadata;
    } catch {
      return {};
    }
  }

  async getDuration(filePath: string): Promise<number> {
    try {
      const mm = await this.mmModule;
      const meta = await mm.parseFile(filePath, {
        duration: true,
        skipCovers: true,
      });
      return meta.format.duration ?? 0;
    } catch {
      return 0;
    }
  }

  private emptyMeta(): ExtractedAudioMeta {
    return {
      title: null,
      authors: [],
      narrator: null,
      duration: 0,
      coverData: null,
      publishedYear: null,
      chapters: [],
    };
  }
}
