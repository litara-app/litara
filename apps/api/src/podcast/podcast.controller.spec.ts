import type { Request } from 'express';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PodcastController } from './podcast.controller';
import { PodcastService } from './podcast.service';

interface RequestWithUser extends Request {
  user: { id: string };
}
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

function makeController() {
  const service: Partial<Record<keyof PodcastService, jest.Mock>> = {
    getSettings: jest.fn(),
    setSettings: jest.fn(),
    subscribe: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    getEpisodes: jest.fn(),
    updateSettings: jest.fn(),
    unsubscribe: jest.fn(),
    requestDownload: jest.fn(),
    streamEpisode: jest.fn(),
    refreshNow: jest.fn(),
  };
  const streamTokenService = { generate: jest.fn(), validate: jest.fn() };
  const controller = new PodcastController(
    service as unknown as PodcastService,
    streamTokenService as never,
  );
  return { controller, service, streamTokenService };
}

describe('PodcastController', () => {
  describe('getSettings', () => {
    it('delegates to service', async () => {
      const { controller, service } = makeController();
      (service.getSettings as jest.Mock).mockResolvedValue({ enabled: true });
      const result = await controller.getSettings();
      expect(result).toEqual({ enabled: true });
    });
  });

  describe('setSettings', () => {
    it('passes enabled to service', async () => {
      const { controller, service } = makeController();
      (service.setSettings as jest.Mock).mockResolvedValue({ enabled: true });
      await controller.setSettings({ enabled: true });
      expect(service.setSettings).toHaveBeenCalledWith(true);
    });

    it('passes disabled to service', async () => {
      const { controller, service } = makeController();
      (service.setSettings as jest.Mock).mockResolvedValue({ enabled: false });
      await controller.setSettings({ enabled: false });
      expect(service.setSettings).toHaveBeenCalledWith(false);
    });
  });

  describe('subscribe', () => {
    it('delegates to service with feedUrl', async () => {
      const { controller, service } = makeController();
      const podcast = {
        id: 'pod-1',
        feedUrl: 'https://example.com/feed.rss',
        title: 'Test',
      };
      (service.subscribe as jest.Mock).mockResolvedValue(podcast);
      const result = await controller.subscribe({
        feedUrl: 'https://example.com/feed.rss',
      });
      expect(result).toEqual(podcast);
      expect(service.subscribe).toHaveBeenCalledWith(
        'https://example.com/feed.rss',
      );
    });

    it('propagates ConflictException (duplicate subscription)', async () => {
      const { controller, service } = makeController();
      (service.subscribe as jest.Mock).mockRejectedValue(
        new ConflictException(),
      );
      await expect(
        controller.subscribe({ feedUrl: 'https://example.com/feed.rss' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates ForbiddenException when podcasts disabled', async () => {
      const { controller, service } = makeController();
      (service.subscribe as jest.Mock).mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        controller.subscribe({ feedUrl: 'https://example.com/feed.rss' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('returns list from service', async () => {
      const { controller, service } = makeController();
      const podcasts = [{ id: 'pod-1' }, { id: 'pod-2' }];
      (service.findAll as jest.Mock).mockResolvedValue(podcasts);
      expect(await controller.findAll()).toEqual(podcasts);
    });

    it('propagates ForbiddenException when podcasts disabled', async () => {
      const { controller, service } = makeController();
      (service.findAll as jest.Mock).mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(controller.findAll()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('findOne', () => {
    it('returns podcast by id', async () => {
      const { controller, service } = makeController();
      (service.findOne as jest.Mock).mockResolvedValue({ id: 'pod-1' });
      expect(await controller.findOne('pod-1')).toEqual({ id: 'pod-1' });
    });

    it('propagates NotFoundException', async () => {
      const { controller, service } = makeController();
      (service.findOne as jest.Mock).mockRejectedValue(new NotFoundException());
      await expect(controller.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getEpisodes', () => {
    const mockReq = { user: { id: 'user-1' } } as RequestWithUser;

    it('calls service with default page/pageSize', async () => {
      const { controller, service } = makeController();
      (service.getEpisodes as jest.Mock).mockResolvedValue({
        episodes: [],
        total: 0,
      });
      await controller.getEpisodes(mockReq, 'pod-1');
      expect(service.getEpisodes).toHaveBeenCalledWith(
        'pod-1',
        'user-1',
        1,
        50,
      );
    });

    it('parses page and pageSize from query strings', async () => {
      const { controller, service } = makeController();
      (service.getEpisodes as jest.Mock).mockResolvedValue({
        episodes: [],
        total: 0,
      });
      await controller.getEpisodes(mockReq, 'pod-1', '3', '25');
      expect(service.getEpisodes).toHaveBeenCalledWith(
        'pod-1',
        'user-1',
        3,
        25,
      );
    });
  });

  describe('updateSettings', () => {
    it('delegates to service', async () => {
      const { controller, service } = makeController();
      (service.updateSettings as jest.Mock).mockResolvedValue({ id: 'pod-1' });
      await controller.updateSettings('pod-1', { refreshIntervalMinutes: 60 });
      expect(service.updateSettings).toHaveBeenCalledWith('pod-1', {
        refreshIntervalMinutes: 60,
      });
    });

    it('propagates BadRequestException for invalid interval', async () => {
      const { controller, service } = makeController();
      (service.updateSettings as jest.Mock).mockRejectedValue(
        new BadRequestException(),
      );
      await expect(
        controller.updateSettings('pod-1', { refreshIntervalMinutes: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unsubscribe', () => {
    it('delegates to service with deleteFiles=false by default', async () => {
      const { controller, service } = makeController();
      (service.unsubscribe as jest.Mock).mockResolvedValue(undefined);
      await controller.unsubscribe('pod-1');
      expect(service.unsubscribe).toHaveBeenCalledWith('pod-1', false);
    });

    it('delegates to service with deleteFiles=true when query param is "true"', async () => {
      const { controller, service } = makeController();
      (service.unsubscribe as jest.Mock).mockResolvedValue(undefined);
      await controller.unsubscribe('pod-1', 'true');
      expect(service.unsubscribe).toHaveBeenCalledWith('pod-1', true);
    });

    it('propagates NotFoundException', async () => {
      const { controller, service } = makeController();
      (service.unsubscribe as jest.Mock).mockRejectedValue(
        new NotFoundException(),
      );
      await expect(controller.unsubscribe('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('requestDownload', () => {
    it('returns queued status for NOT_DOWNLOADED episode', async () => {
      const { controller, service } = makeController();
      (service.requestDownload as jest.Mock).mockResolvedValue({
        status: 'queued',
      });
      const result = await controller.requestDownload('ep-1');
      expect(result).toEqual({ status: 'queued' });
    });

    it('propagates NotFoundException for missing episode', async () => {
      const { controller, service } = makeController();
      (service.requestDownload as jest.Mock).mockRejectedValue(
        new NotFoundException(),
      );
      await expect(
        controller.requestDownload('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /* eslint-disable @typescript-eslint/unbound-method */
  describe('guard configuration', () => {
    it('getSettings has JwtAuthGuard and AdminGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PodcastController.prototype.getSettings,
      ) as unknown[];
      expect(guards).toBeDefined();
      expect(guards.some((g) => g === JwtAuthGuard)).toBe(true);
      expect(guards.some((g) => g === AdminGuard)).toBe(true);
    });

    it('setSettings has JwtAuthGuard and AdminGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PodcastController.prototype.setSettings,
      ) as unknown[];
      expect(guards).toBeDefined();
      expect(guards.some((g) => g === JwtAuthGuard)).toBe(true);
      expect(guards.some((g) => g === AdminGuard)).toBe(true);
    });

    it('subscribe has JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        PodcastController.prototype.subscribe,
      ) as unknown[];
      expect(guards).toBeDefined();
      expect(guards.some((g) => g === JwtAuthGuard)).toBe(true);
    });
  });
  /* eslint-enable @typescript-eslint/unbound-method */
});
