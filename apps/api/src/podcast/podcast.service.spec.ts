import { PodcastService } from './podcast.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeService(
  overrides: Partial<ConstructorParameters<typeof PodcastService>[0]> = {},
) {
  const prisma = {
    serverSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    podcast: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    podcastEpisode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ...overrides,
  };
  return { service: new PodcastService(prisma as never), prisma };
}

// ── parseDuration (private — tested via syncEpisodes indirectly, but also via reflection) ──

describe('PodcastService', () => {
  // ── parseDuration ─────────────────────────────────────────────────────────

  describe('parseDuration (via private reflection)', () => {
    const { service } = makeService();
    const parse = (s: string): number =>
      (
        service as unknown as { parseDuration: (s: string) => number }
      ).parseDuration(s);

    it('parses plain seconds', () => {
      expect(parse('3600')).toBe(3600);
    });

    it('parses mm:ss', () => {
      expect(parse('5:30')).toBe(330);
    });

    it('parses hh:mm:ss', () => {
      expect(parse('1:05:30')).toBe(3930);
    });
  });

  // ── getSettings ───────────────────────────────────────────────────────────

  describe('getSettings', () => {
    it('returns enabled=false when no DB row exists', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock).mockResolvedValue(null);
      const settings = await service.getSettings();
      expect(settings.enabled).toBe(false);
    });

    it('returns enabled=true when row value is "true"', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock).mockResolvedValue({
        value: 'true',
      });
      const settings = await service.getSettings();
      expect(settings.enabled).toBe(true);
    });
  });

  // ── setSettings ───────────────────────────────────────────────────────────

  describe('setSettings', () => {
    it('upserts podcasts_enabled key and returns updated settings', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.upsert as jest.Mock).mockResolvedValue({});
      (prisma.serverSettings.findUnique as jest.Mock).mockResolvedValue({
        value: 'true',
      });
      const result = await service.setSettings(true);
      expect(prisma.serverSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'podcasts_enabled' },
          update: { value: 'true' },
        }),
      );
      expect(result.enabled).toBe(true);
    });
  });

  // ── subscribe ─────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('throws ForbiddenException when podcasts are disabled', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock).mockResolvedValue({
        value: 'false',
      });
      await expect(
        service.subscribe('https://example.com/feed.rss'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ConflictException when already subscribed', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcast.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-id',
        feedUrl: 'https://example.com/feed.rss',
        subscribed: true,
      });
      await expect(
        service.subscribe('https://example.com/feed.rss'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── updateSettings ────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('throws BadRequestException for refreshInterval below 15', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcast.findUnique as jest.Mock).mockResolvedValue({
        id: 'pod-1',
      });
      await expect(
        service.updateSettings('pod-1', { refreshIntervalMinutes: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for refreshInterval above 10080', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcast.findUnique as jest.Mock).mockResolvedValue({
        id: 'pod-1',
      });
      await expect(
        service.updateSettings('pod-1', { refreshIntervalMinutes: 99999 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when podcast does not exist', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcast.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateSettings('nonexistent', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── requestDownload ───────────────────────────────────────────────────────

  describe('requestDownload', () => {
    it('returns already_downloaded when status is DOWNLOADED', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcastEpisode.findUnique as jest.Mock).mockResolvedValue({
        id: 'ep-1',
        downloadStatus: 'DOWNLOADED',
      });
      const result = await service.requestDownload('ep-1');
      expect(result.status).toBe('already_downloaded');
    });

    it('returns already_downloading when status is DOWNLOADING', async () => {
      const { service, prisma } = makeService();
      (prisma.serverSettings.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: 'true' })
        .mockResolvedValueOnce({ value: '/podcasts' });
      (prisma.podcastEpisode.findUnique as jest.Mock).mockResolvedValue({
        id: 'ep-1',
        downloadStatus: 'DOWNLOADING',
      });
      const result = await service.requestDownload('ep-1');
      expect(result.status).toBe('already_downloading');
    });
  });

  // ── applyRetentionPolicy ──────────────────────────────────────────────────

  describe('applyRetentionPolicy', () => {
    it('does nothing for KEEP_ALL policy', async () => {
      const { service, prisma } = makeService();
      (prisma.podcast.findUnique as jest.Mock).mockResolvedValue({
        id: 'pod-1',
        retentionPolicy: 'KEEP_ALL',
        keepLatestN: null,
      });
      const updateSpy = prisma.podcastEpisode.update as jest.Mock;
      await service.applyRetentionPolicy('pod-1');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
