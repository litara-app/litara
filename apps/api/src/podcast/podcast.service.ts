import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import Parser from 'rss-parser';
import { DatabaseService } from '../database/database.service';
import type {
  DownloadPolicy,
  EpisodeDownloadStatus,
  RetentionPolicy,
} from '@prisma/client';
import type { Response } from 'express';
import type { PodcastSettingsDto } from './dto/podcast-settings.dto';

interface ActiveDownload {
  episodeId: string;
  abortController: AbortController;
}

@Injectable()
export class PodcastService {
  private readonly logger = new Logger(PodcastService.name);
  private readonly parser = new Parser();
  private readonly storagePath =
    process.env.PODCAST_STORAGE_PATH ?? '/data/podcasts';
  private activeDownloads: ActiveDownload[] = [];
  private downloadQueue = new Set<string>();
  private runningDownloads = 0;
  private readonly maxConcurrentDownloads = 2;

  private activeDownloadTaskId: string | null = null;
  private batchQueued = 0;
  private batchDownloaded = 0;
  private batchFailed = 0;

  constructor(private readonly prisma: DatabaseService) {}

  async getSettings(): Promise<PodcastSettingsDto> {
    const enabledRow = await this.prisma.serverSettings.findUnique({
      where: { key: 'podcasts_enabled' },
    });
    return { enabled: enabledRow?.value === 'true' };
  }

  async setSettings(enabled: boolean): Promise<PodcastSettingsDto> {
    await this.prisma.serverSettings.upsert({
      where: { key: 'podcasts_enabled' },
      create: { key: 'podcasts_enabled', value: String(enabled) },
      update: { value: String(enabled) },
    });
    return this.getSettings();
  }

  private async assertEnabled(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.enabled) {
      throw new ForbiddenException('Podcasts feature is not enabled');
    }
  }

  async subscribe(feedUrl: string) {
    await this.assertEnabled();

    const existing = await this.prisma.podcast.findUnique({
      where: { feedUrl },
    });
    if (existing) {
      if (!existing.subscribed) {
        const updated = await this.prisma.podcast.update({
          where: { id: existing.id },
          data: { subscribed: true },
          include: { _count: { select: { episodes: true } } },
        });
        return this.toPodcastDto(updated, updated._count.episodes);
      }
      throw new ConflictException('Already subscribed to this feed');
    }

    let feed: Awaited<ReturnType<typeof this.parser.parseURL>>;
    try {
      feed = await this.parser.parseURL(feedUrl);
    } catch (err) {
      throw new BadRequestException(
        `Could not fetch or parse feed: ${(err as Error).message}`,
      );
    }

    const now = new Date();
    const podcast = await this.prisma.podcast.create({
      data: {
        feedUrl,
        title: feed.title ?? 'Untitled Podcast',
        description: feed.description ?? null,
        artworkUrl: feed.image?.url ?? null,
        author: feed.itunes?.author ?? null,
        websiteUrl: feed.link ?? null,
        lastRefreshedAt: now,
        nextRefreshAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
      include: { _count: { select: { episodes: true } } },
    });

    void this.syncEpisodes(podcast.id, feed.items ?? []);

    return this.toPodcastDto(podcast, 0);
  }

  async findAll() {
    await this.assertEnabled();
    const podcasts = await this.prisma.podcast.findMany({
      orderBy: { title: 'asc' },
      include: { _count: { select: { episodes: true } } },
    });
    return podcasts.map((p) => this.toPodcastDto(p, p._count.episodes));
  }

  async findOne(id: string) {
    await this.assertEnabled();
    const podcast = await this.prisma.podcast.findUnique({
      where: { id },
      include: { _count: { select: { episodes: true } } },
    });
    if (!podcast) throw new NotFoundException('Podcast not found');
    return this.toPodcastDto(podcast, podcast._count.episodes);
  }

  async getEpisodes(
    podcastId: string,
    userId: string,
    page = 1,
    pageSize = 50,
  ) {
    await this.assertEnabled();
    const podcast = await this.prisma.podcast.findUnique({
      where: { id: podcastId },
    });
    if (!podcast) throw new NotFoundException('Podcast not found');

    const [episodes, total] = await Promise.all([
      this.prisma.podcastEpisode.findMany({
        where: { podcastId },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          progress: { where: { userId }, select: { currentTime: true } },
        },
      }),
      this.prisma.podcastEpisode.count({ where: { podcastId } }),
    ]);

    return {
      episodes: episodes.map((e) =>
        this.toEpisodeDto(e, e.progress[0]?.currentTime ?? null),
      ),
      total,
      page,
      pageSize,
    };
  }

  async saveEpisodeProgress(
    userId: string,
    episodeId: string,
    currentTime: number,
  ) {
    await this.assertEnabled();
    const episode = await this.prisma.podcastEpisode.findUnique({
      where: { id: episodeId },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    await this.prisma.podcastEpisodeProgress.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, currentTime },
      update: { currentTime },
    });

    if (episode.duration && currentTime / episode.duration >= 0.95) {
      await this.handleListenedCompletion(episodeId, 95);
    }
  }

  async updateSettings(
    id: string,
    dto: {
      refreshIntervalMinutes?: number;
      downloadPolicy?: DownloadPolicy;
      keepLatestN?: number;
      retentionPolicy?: RetentionPolicy;
    },
  ) {
    await this.assertEnabled();
    const podcast = await this.prisma.podcast.findUnique({ where: { id } });
    if (!podcast) throw new NotFoundException('Podcast not found');

    if (dto.refreshIntervalMinutes !== undefined) {
      if (
        dto.refreshIntervalMinutes < 15 ||
        dto.refreshIntervalMinutes > 10080
      ) {
        throw new BadRequestException(
          'refreshIntervalMinutes must be between 15 and 10080',
        );
      }
    }

    const updated = await this.prisma.podcast.update({
      where: { id },
      data: {
        ...(dto.refreshIntervalMinutes !== undefined && {
          refreshIntervalMinutes: dto.refreshIntervalMinutes,
        }),
        ...(dto.downloadPolicy !== undefined && {
          downloadPolicy: dto.downloadPolicy,
        }),
        ...(dto.keepLatestN !== undefined && { keepLatestN: dto.keepLatestN }),
        ...(dto.retentionPolicy !== undefined && {
          retentionPolicy: dto.retentionPolicy,
        }),
      },
      include: { _count: { select: { episodes: true } } },
    });

    return this.toPodcastDto(updated, updated._count.episodes);
  }

  async unsubscribe(id: string, deleteFiles: boolean) {
    await this.assertEnabled();
    const podcast = await this.prisma.podcast.findUnique({
      where: { id },
      include: {
        episodes: {
          select: { id: true, downloadPath: true, downloadStatus: true },
        },
      },
    });
    if (!podcast) throw new NotFoundException('Podcast not found');

    for (const ep of podcast.episodes) {
      if (
        ep.downloadStatus === 'DOWNLOADING' ||
        ep.downloadStatus === 'PENDING'
      ) {
        this.cancelDownload(ep.id);
      }
      if (deleteFiles) this.tryDeleteFile(ep.downloadPath);
    }

    if (deleteFiles) {
      await this.prisma.podcastEpisode.updateMany({
        where: {
          podcastId: id,
          downloadStatus: {
            in: ['DOWNLOADED', 'DOWNLOADING', 'PENDING', 'FAILED'],
          },
        },
        data: {
          downloadStatus: 'NOT_DOWNLOADED',
          downloadPath: null,
          fileSize: null,
        },
      });
    }

    await this.prisma.podcast.update({
      where: { id },
      data: { subscribed: false },
    });
  }

  async requestDownload(episodeId: string) {
    await this.assertEnabled();
    const episode = await this.prisma.podcastEpisode.findUnique({
      where: { id: episodeId },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    if (episode.downloadStatus === 'DOWNLOADED')
      return { status: 'already_downloaded' };
    if (episode.downloadStatus === 'DOWNLOADING')
      return { status: 'already_downloading' };

    await this.prisma.podcastEpisode.update({
      where: { id: episodeId },
      data: { downloadStatus: 'PENDING' },
    });

    this.enqueueDownload(episodeId);
    return { status: 'queued' };
  }

  async streamEpisode(episodeId: string, res: Response) {
    await this.assertEnabled();
    const episode = await this.prisma.podcastEpisode.findUnique({
      where: { id: episodeId },
    });
    if (
      !episode ||
      episode.downloadStatus !== 'DOWNLOADED' ||
      !episode.downloadPath
    ) {
      throw new NotFoundException('Episode not downloaded');
    }
    let stat: ReturnType<typeof fs.statSync>;
    try {
      stat = fs.statSync(episode.downloadPath);
    } catch {
      throw new NotFoundException('Episode file not found on disk');
    }
    const ext = path.extname(episode.downloadPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/ogg',
      '.aac': 'audio/aac',
    };
    const contentType = mimeTypes[ext] ?? 'audio/mpeg';

    const rangeHeader = (
      res as unknown as { req: { headers: { range?: string } } }
    ).req?.headers?.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(episode.downloadPath, { start, end }).pipe(
        res as unknown as NodeJS.WritableStream,
      );
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(episode.downloadPath).pipe(
        res as unknown as NodeJS.WritableStream,
      );
    }
  }

  async syncEpisodes(
    podcastId: string,
    items: Array<{
      guid?: string;
      title?: string;
      contentSnippet?: string;
      isoDate?: string;
      itunes?: { duration?: string };
      enclosure?: { url?: string };
    }>,
  ) {
    const podcast = await this.prisma.podcast.findUnique({
      where: { id: podcastId },
    });
    if (!podcast) return;

    const existingGuids = new Set(
      (
        await this.prisma.podcastEpisode.findMany({
          where: { podcastId },
          select: { guid: true },
        })
      ).map((e) => e.guid),
    );

    const newItems = items.filter(
      (item) =>
        item.guid && !existingGuids.has(item.guid) && item.enclosure?.url,
    );

    if (newItems.length === 0) return;

    await this.prisma.podcastEpisode.createMany({
      data: newItems.map((item) => ({
        podcastId,
        guid: item.guid!,
        title: item.title ?? 'Untitled Episode',
        description: item.contentSnippet ?? null,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        duration: item.itunes?.duration
          ? this.parseDuration(item.itunes.duration)
          : null,
        audioUrl: item.enclosure!.url!,
        downloadStatus: 'NOT_DOWNLOADED' as EpisodeDownloadStatus,
      })),
      skipDuplicates: true,
    });

    if (podcast.downloadPolicy !== 'MANUAL') {
      await this.enqueueNewEpisodesForDownload(podcastId, podcast);
    }
  }

  private async enqueueNewEpisodesForDownload(
    podcastId: string,
    podcast: { downloadPolicy: DownloadPolicy; keepLatestN: number | null },
  ) {
    let episodesToQueue: { id: string }[];

    if (podcast.downloadPolicy === 'ALL') {
      episodesToQueue = await this.prisma.podcastEpisode.findMany({
        where: { podcastId, downloadStatus: 'NOT_DOWNLOADED' },
        orderBy: { publishedAt: 'desc' },
        select: { id: true },
      });
    } else if (podcast.downloadPolicy === 'LATEST_N' && podcast.keepLatestN) {
      episodesToQueue = await this.prisma.podcastEpisode.findMany({
        where: { podcastId, downloadStatus: 'NOT_DOWNLOADED' },
        orderBy: { publishedAt: 'desc' },
        take: podcast.keepLatestN,
        select: { id: true },
      });
    } else {
      return;
    }

    if (episodesToQueue.length === 0) return;

    await this.prisma.podcastEpisode.updateMany({
      where: { id: { in: episodesToQueue.map((ep) => ep.id) } },
      data: { downloadStatus: 'PENDING' },
    });
    for (const ep of episodesToQueue) {
      this.enqueueDownload(ep.id);
    }
  }

  private async ensureDownloadTask(): Promise<void> {
    if (this.activeDownloadTaskId) {
      const existing = await this.prisma.task.findUnique({
        where: { id: this.activeDownloadTaskId },
      });
      if (
        existing &&
        existing.status !== 'COMPLETED' &&
        existing.status !== 'FAILED'
      )
        return;
    }
    this.batchQueued = 0;
    this.batchDownloaded = 0;
    this.batchFailed = 0;
    const task = await this.prisma.task.create({
      data: {
        type: 'PODCAST_DOWNLOAD',
        status: 'PENDING',
        payload: JSON.stringify({
          processed: 0,
          total: 0,
          downloaded: 0,
          failed: 0,
        }),
      },
    });
    this.activeDownloadTaskId = task.id;
  }

  private async updateDownloadTask(
    currentEpisodeTitle?: string,
  ): Promise<void> {
    if (!this.activeDownloadTaskId) return;
    await this.prisma.task
      .update({
        where: { id: this.activeDownloadTaskId },
        data: {
          status: 'PROCESSING',
          payload: JSON.stringify({
            processed: this.batchDownloaded + this.batchFailed,
            total: this.batchQueued,
            downloaded: this.batchDownloaded,
            failed: this.batchFailed,
            currentEpisodeTitle,
          }),
        },
      })
      .catch(() => {});
  }

  private async completeDownloadTask(): Promise<void> {
    if (!this.activeDownloadTaskId) return;
    await this.prisma.task
      .update({
        where: { id: this.activeDownloadTaskId },
        data: {
          status: 'COMPLETED',
          payload: JSON.stringify({
            processed: this.batchDownloaded + this.batchFailed,
            total: this.batchQueued,
            downloaded: this.batchDownloaded,
            failed: this.batchFailed,
          }),
        },
      })
      .catch(() => {});
    this.activeDownloadTaskId = null;
    this.batchQueued = 0;
    this.batchDownloaded = 0;
    this.batchFailed = 0;
  }

  enqueueDownload(episodeId: string) {
    if (!this.downloadQueue.has(episodeId)) {
      this.downloadQueue.add(episodeId);
      void this.ensureDownloadTask().then(() => {
        this.batchQueued++;
        void this.updateDownloadTask();
      });
      void this.processQueue();
    }
  }

  private processQueue() {
    while (
      this.runningDownloads < this.maxConcurrentDownloads &&
      this.downloadQueue.size > 0
    ) {
      const [episodeId] = this.downloadQueue;
      this.downloadQueue.delete(episodeId);
      this.runningDownloads++;
      void this.downloadEpisode(episodeId).finally(() => {
        this.runningDownloads--;
        void this.processQueue();
        if (this.runningDownloads === 0 && this.downloadQueue.size === 0) {
          void this.completeDownloadTask();
        }
      });
    }
  }

  private async downloadEpisode(episodeId: string) {
    const episode = await this.prisma.podcastEpisode.findUnique({
      where: { id: episodeId },
      include: { podcast: { select: { title: true } } },
    });
    if (!episode) return;

    const episodeDir = path.join(
      this.storagePath,
      this.slugify(episode.podcast.title),
    );
    fs.mkdirSync(episodeDir, { recursive: true });

    const url = new URL(episode.audioUrl);
    const ext = path.extname(url.pathname) || '.mp3';
    const safeGuid = episode.guid.replace(/[^a-z0-9]/gi, '-').slice(0, 80);
    const filePath = path.join(episodeDir, `${safeGuid}${ext}`);

    await this.prisma.podcastEpisode.update({
      where: { id: episodeId },
      data: { downloadStatus: 'DOWNLOADING' },
    });

    void this.updateDownloadTask(episode.title);

    const abortController = new AbortController();
    this.activeDownloads.push({ episodeId, abortController });

    try {
      await this.streamDownload(
        episode.audioUrl,
        filePath,
        abortController.signal,
      );

      const stat = fs.statSync(filePath);
      await this.prisma.podcastEpisode.update({
        where: { id: episodeId },
        data: {
          downloadStatus: 'DOWNLOADED',
          downloadPath: filePath,
          fileSize: BigInt(stat.size),
        },
      });

      this.logger.log(`Downloaded episode "${episode.title}" to ${filePath}`);
      this.batchDownloaded++;
      void this.updateDownloadTask();
      await this.applyRetentionPolicy(episode.podcastId);
    } catch (err) {
      if ((err as Error).message === 'Download cancelled') {
        this.logger.log(`Download cancelled for episode ${episodeId}`);
      } else {
        this.logger.warn(
          `Download failed for episode ${episodeId}: ${(err as Error).message}`,
        );
        this.batchFailed++;
        void this.updateDownloadTask();
        await this.prisma.podcastEpisode.update({
          where: { id: episodeId },
          data: { downloadStatus: 'FAILED' },
        });
        this.tryDeleteFile(filePath);
      }
    } finally {
      this.activeDownloads = this.activeDownloads.filter(
        (d) => d.episodeId !== episodeId,
      );
    }
  }

  private streamDownload(
    url: string,
    destPath: string,
    signal: AbortSignal,
    redirects = 0,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirects > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      if (signal.aborted) {
        reject(new Error('Download cancelled'));
        return;
      }

      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const file = fs.createWriteStream(destPath);

      const onAbort = () => {
        request.destroy();
        file.close();
        reject(new Error('Download cancelled'));
      };

      signal.addEventListener('abort', onAbort);

      const request = protocol.get(url, (res) => {
        const { statusCode } = res;

        if (statusCode && [301, 302, 303, 307, 308].includes(statusCode)) {
          signal.removeEventListener('abort', onAbort);
          file.close();
          res.resume();
          const location = res.headers.location;
          if (!location) {
            reject(
              new Error(
                `Redirect with no Location header (HTTP ${statusCode})`,
              ),
            );
            return;
          }
          const nextUrl = location.startsWith('http')
            ? location
            : new URL(location, url).toString();
          resolve(
            this.streamDownload(nextUrl, destPath, signal, redirects + 1),
          );
          return;
        }

        if (statusCode && statusCode >= 400) {
          signal.removeEventListener('abort', onAbort);
          file.close();
          res.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }

        res.pipe(file);
        file.on('finish', () => {
          signal.removeEventListener('abort', onAbort);
          file.close(() => resolve());
        });
        file.on('error', (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
      });

      request.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        file.close();
        reject(err);
      });

      request.setTimeout(60_000, () => {
        request.destroy();
        reject(new Error('Download timed out'));
      });
    });
  }

  private cancelDownload(episodeId: string) {
    const active = this.activeDownloads.find((d) => d.episodeId === episodeId);
    if (active) {
      active.abortController.abort();
    }
    this.downloadQueue.delete(episodeId);
  }

  async applyRetentionPolicy(podcastId: string) {
    const podcast = await this.prisma.podcast.findUnique({
      where: { id: podcastId },
    });
    if (!podcast || podcast.retentionPolicy === 'KEEP_ALL') return;

    if (podcast.retentionPolicy === 'KEEP_LATEST_N' && podcast.keepLatestN) {
      const downloaded = await this.prisma.podcastEpisode.findMany({
        where: { podcastId, downloadStatus: 'DOWNLOADED' },
        orderBy: { publishedAt: 'desc' },
        select: { id: true, downloadPath: true },
      });

      const toDelete = downloaded.slice(podcast.keepLatestN);
      for (const ep of toDelete) {
        this.tryDeleteFile(ep.downloadPath);
        await this.prisma.podcastEpisode.update({
          where: { id: ep.id },
          data: {
            downloadStatus: 'NOT_DOWNLOADED',
            downloadPath: null,
            fileSize: null,
          },
        });
      }
    }
  }

  async refreshNow(podcastId: string) {
    await this.assertEnabled();
    const podcast = await this.prisma.podcast.findUnique({
      where: { id: podcastId },
    });
    if (!podcast) throw new NotFoundException('Podcast not found');

    let feed: Awaited<ReturnType<typeof this.parser.parseURL>>;
    try {
      feed = await this.parser.parseURL(podcast.feedUrl);
    } catch (err) {
      throw new BadRequestException(
        `Could not fetch feed: ${(err as Error).message}`,
      );
    }

    const now = new Date();
    await this.prisma.podcast.update({
      where: { id: podcastId },
      data: {
        title: feed.title ?? podcast.title,
        description: feed.description ?? podcast.description,
        artworkUrl: feed.image?.url ?? podcast.artworkUrl,
        author: feed.itunes?.author ?? podcast.author,
        lastRefreshedAt: now,
        nextRefreshAt: new Date(
          now.getTime() + podcast.refreshIntervalMinutes * 60 * 1000,
        ),
      },
    });

    await this.syncEpisodes(podcastId, feed.items ?? []);
    return this.findOne(podcastId);
  }

  async handleListenedCompletion(
    episodeId: string,
    progressPercentage: number,
  ) {
    if (progressPercentage < 95) return;

    const episode = await this.prisma.podcastEpisode.findUnique({
      where: { id: episodeId },
      include: { podcast: { select: { retentionPolicy: true } } },
    });
    if (!episode || episode.podcast.retentionPolicy !== 'DELETE_AFTER_LISTENED')
      return;
    if (episode.downloadStatus !== 'DOWNLOADED' || !episode.downloadPath)
      return;

    this.tryDeleteFile(episode.downloadPath);
    await this.prisma.podcastEpisode.update({
      where: { id: episodeId },
      data: {
        downloadStatus: 'NOT_DOWNLOADED',
        downloadPath: null,
        fileSize: null,
      },
    });
  }

  private slugify(title: string): string {
    return title
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()
      .slice(0, 50);
  }

  private tryDeleteFile(filePath: string | null | undefined): void {
    if (!filePath) return;
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  private parseDuration(duration: string): number {
    if (/^\d+$/.test(duration)) return parseInt(duration, 10);
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  async scanStorage() {
    const episodes = await this.prisma.podcastEpisode.findMany({
      where: { downloadPath: { not: null } },
      select: { id: true, downloadPath: true, downloadStatus: true },
    });

    const toMarkDownloaded: string[] = [];
    const toMarkMissing: string[] = [];

    for (const ep of episodes) {
      const exists = fs.existsSync(ep.downloadPath!);
      if (exists && ep.downloadStatus !== 'DOWNLOADED') {
        toMarkDownloaded.push(ep.id);
      } else if (!exists && ep.downloadStatus === 'DOWNLOADED') {
        toMarkMissing.push(ep.id);
      }
    }

    await Promise.all([
      toMarkDownloaded.length > 0 &&
        this.prisma.podcastEpisode.updateMany({
          where: { id: { in: toMarkDownloaded } },
          data: { downloadStatus: 'DOWNLOADED' },
        }),
      toMarkMissing.length > 0 &&
        this.prisma.podcastEpisode.updateMany({
          where: { id: { in: toMarkMissing } },
          data: {
            downloadStatus: 'NOT_DOWNLOADED',
            downloadPath: null,
            fileSize: null,
          },
        }),
    ]);

    this.logger.log('Storage scan complete');
  }

  async importFromStorage(): Promise<{
    newPodcasts: number;
    newEpisodes: number;
    updatedEpisodes: number;
  }> {
    const audioExts = new Set(['.mp3', '.m4a', '.ogg', '.opus', '.aac']);
    let newPodcasts = 0;
    let newEpisodes = 0;
    let updatedEpisodes = 0;

    if (!fs.existsSync(this.storagePath)) {
      return { newPodcasts, newEpisodes, updatedEpisodes };
    }

    const allPodcasts = await this.prisma.podcast.findMany({
      select: { id: true, title: true, feedUrl: true },
    });

    const topEntries = fs.readdirSync(this.storagePath, {
      withFileTypes: true,
    });

    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const folderPath = path.join(this.storagePath, folderName);
      const placeholderFeedUrl = `local://${folderName}`;

      const match = allPodcasts.find(
        (p) =>
          p.feedUrl === placeholderFeedUrl ||
          this.slugify(p.title) === folderName,
      );

      let podcastId: string;
      if (match) {
        podcastId = match.id;
      } else {
        const humanTitle = folderName
          .replace(/-+/g, ' ')
          .split(' ')
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(' ');
        const created = await this.prisma.podcast.create({
          data: {
            feedUrl: placeholderFeedUrl,
            title: humanTitle,
            subscribed: false,
          },
        });
        podcastId = created.id;
        allPodcasts.push({
          id: created.id,
          title: humanTitle,
          feedUrl: placeholderFeedUrl,
        });
        newPodcasts++;
      }

      const existingEpisodes = await this.prisma.podcastEpisode.findMany({
        where: { podcastId },
        select: {
          id: true,
          guid: true,
          downloadPath: true,
          downloadStatus: true,
        },
      });
      const knownByPath = new Map(
        existingEpisodes
          .filter((e) => e.downloadPath !== null)
          .map((e) => [e.downloadPath!, e]),
      );
      const knownGuids = new Set(existingEpisodes.map((e) => e.guid));

      const files = fs.readdirSync(folderPath, { withFileTypes: true });

      for (const fileEntry of files) {
        if (!fileEntry.isFile()) continue;
        const ext = path.extname(fileEntry.name).toLowerCase();
        if (!audioExts.has(ext)) continue;

        const filePath = path.join(folderPath, fileEntry.name);
        const guid = `local-${fileEntry.name}`;

        const existingByPath = knownByPath.get(filePath);
        if (existingByPath) {
          if (existingByPath.downloadStatus !== 'DOWNLOADED') {
            await this.prisma.podcastEpisode.update({
              where: { id: existingByPath.id },
              data: { downloadStatus: 'DOWNLOADED' },
            });
            updatedEpisodes++;
          }
          continue;
        }

        if (knownGuids.has(guid)) continue;

        const baseName = path.basename(fileEntry.name, ext);
        const humanTitle = baseName
          .replace(/-+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const stat = fs.statSync(filePath);

        await this.prisma.podcastEpisode.create({
          data: {
            podcastId,
            guid,
            title: humanTitle || fileEntry.name,
            audioUrl: filePath,
            downloadStatus: 'DOWNLOADED',
            downloadPath: filePath,
            fileSize: BigInt(stat.size),
          },
        });
        knownByPath.set(filePath, {
          id: '',
          guid,
          downloadPath: filePath,
          downloadStatus: 'DOWNLOADED' as const,
        });
        knownGuids.add(guid);
        newEpisodes++;
      }
    }

    this.logger.log(
      `Import scan: ${newPodcasts} new podcasts, ${newEpisodes} new episodes, ${updatedEpisodes} updated`,
    );
    return { newPodcasts, newEpisodes, updatedEpisodes };
  }

  private toPodcastDto(
    p: {
      id: string;
      feedUrl: string;
      title: string;
      description: string | null;
      artworkUrl: string | null;
      author: string | null;
      websiteUrl: string | null;
      lastRefreshedAt: Date | null;
      refreshIntervalMinutes: number;
      downloadPolicy: DownloadPolicy;
      keepLatestN: number | null;
      retentionPolicy: RetentionPolicy;
      subscribed: boolean;
      createdAt: Date;
    },
    episodeCount: number,
  ) {
    return {
      id: p.id,
      feedUrl: p.feedUrl,
      title: p.title,
      description: p.description,
      artworkUrl: p.artworkUrl,
      author: p.author,
      websiteUrl: p.websiteUrl,
      lastRefreshedAt: p.lastRefreshedAt?.toISOString() ?? null,
      refreshIntervalMinutes: p.refreshIntervalMinutes,
      downloadPolicy: p.downloadPolicy,
      keepLatestN: p.keepLatestN,
      retentionPolicy: p.retentionPolicy,
      subscribed: p.subscribed,
      episodeCount,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private toEpisodeDto(
    e: {
      id: string;
      podcastId: string;
      guid: string;
      title: string;
      description: string | null;
      publishedAt: Date | null;
      duration: number | null;
      audioUrl: string;
      downloadStatus: EpisodeDownloadStatus;
      downloadPath: string | null;
      fileSize: bigint | null;
      createdAt: Date;
    },
    currentTime: number | null = null,
  ) {
    return {
      id: e.id,
      podcastId: e.podcastId,
      guid: e.guid,
      title: e.title,
      description: e.description,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      duration: e.duration,
      audioUrl: e.audioUrl,
      downloadStatus: e.downloadStatus,
      downloadPath: e.downloadPath,
      fileSize: e.fileSize?.toString() ?? null,
      createdAt: e.createdAt.toISOString(),
      currentTime,
    };
  }
}
