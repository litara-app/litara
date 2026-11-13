import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { DatabaseService } from '../database/database.service';
import { PodcastService } from './podcast.service';

@Injectable()
export class PodcastSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PodcastSchedulerService.name);
  private readonly parser = new Parser();

  constructor(
    private readonly prisma: DatabaseService,
    private readonly podcastService: PodcastService,
  ) {}

  async onModuleInit() {
    const settings = await this.podcastService.getSettings();
    if (!settings.enabled) return;
    void this.podcastService.scanStorage();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async pollFeeds() {
    const settings = await this.podcastService.getSettings();
    if (!settings.enabled) return;

    const now = new Date();
    const due = await this.prisma.podcast.findMany({
      where: {
        subscribed: true,
        OR: [{ nextRefreshAt: null }, { nextRefreshAt: { lte: now } }],
      },
      select: { id: true, feedUrl: true, refreshIntervalMinutes: true },
    });

    for (const podcast of due) {
      void this.refreshPodcast(
        podcast.id,
        podcast.feedUrl,
        podcast.refreshIntervalMinutes,
      );
    }
  }

  private async refreshPodcast(
    id: string,
    feedUrl: string,
    intervalMinutes: number,
  ) {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      const now = new Date();
      const nextRefreshAt = new Date(
        now.getTime() + intervalMinutes * 60 * 1000,
      );

      await this.prisma.podcast.update({
        where: { id },
        data: {
          title: feed.title ?? undefined,
          description: feed.description ?? undefined,
          artworkUrl: feed.image?.url ?? undefined,
          author: feed.itunes?.author ?? undefined,
          websiteUrl: feed.link ?? undefined,
          lastRefreshedAt: now,
          nextRefreshAt,
        },
      });

      await this.podcastService.syncEpisodes(id, feed.items ?? []);
      this.logger.log(`Refreshed feed for podcast ${id}`);
    } catch (err) {
      this.logger.warn(
        `Failed to refresh podcast ${id}: ${(err as Error).message}`,
      );
      const intervalMinutesNum = intervalMinutes;
      const nextRefreshAt = new Date(
        Date.now() + intervalMinutesNum * 60 * 1000,
      );
      await this.prisma.podcast
        .update({ where: { id }, data: { nextRefreshAt } })
        .catch(() => {});
    }
  }
}
