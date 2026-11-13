import { Test } from '@nestjs/testing';
import { ProgressSource } from '@prisma/client';
import { ReadingProgressService } from './reading-progress.service';
import { DatabaseService } from '../database/database.service';

const mockPrisma = {
  readingProgress: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  userReview: {
    upsert: jest.fn(),
  },
  userSettings: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('ReadingProgressService', () => {
  let service: ReadingProgressService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReadingProgressService,
        { provide: DatabaseService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ReadingProgressService);
    jest.clearAllMocks();
  });

  // ─── upsertProgress ───────────────────────────────────────────────────────

  describe('upsertProgress', () => {
    it('defaults to LITARA source when none provided', async () => {
      const fakeProgress = { id: 'p1', source: ProgressSource.LITARA };
      mockPrisma.readingProgress.upsert.mockResolvedValue(fakeProgress);
      // percentage === 0: no transaction needed
      const result = await service.upsertProgress('book-1', 'user-1', {
        location: 'epubcfi(/6/4)',
        percentage: 0,
      });
      expect(mockPrisma.readingProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_bookId_source: {
              userId: 'user-1',
              bookId: 'book-1',
              source: ProgressSource.LITARA,
            },
          },
          create: expect.objectContaining({
            source: ProgressSource.LITARA,
          }) as unknown,
        }),
      );
      expect(result).toBe(fakeProgress);
    });

    it('uses provided KOREADER source', async () => {
      mockPrisma.readingProgress.upsert.mockResolvedValue({});
      await service.upsertProgress('book-1', 'user-1', {
        location: 'kp:01234',
        percentage: 0,
        source: ProgressSource.KOREADER,
      });
      expect(mockPrisma.readingProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_bookId_source: {
              userId: 'user-1',
              bookId: 'book-1',
              source: ProgressSource.KOREADER,
            },
          },
        }),
      );
    });

    it('runs transaction to mark READING when percentage > 0', async () => {
      const fakeProgress = { id: 'p1' };
      mockPrisma.readingProgress.upsert.mockResolvedValue(fakeProgress);
      mockPrisma.userReview.upsert.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([fakeProgress, {}]);

      const result = await service.upsertProgress('book-1', 'user-1', {
        location: 'epubcfi(/6/4)',
        percentage: 0.5,
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).toBe(fakeProgress);
    });

    it('does not run transaction when percentage is 0', async () => {
      mockPrisma.readingProgress.upsert.mockResolvedValue({});
      await service.upsertProgress('book-1', 'user-1', {
        location: 'epubcfi(/6/4)',
        percentage: 0,
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not run transaction when percentage is undefined', async () => {
      mockPrisma.readingProgress.upsert.mockResolvedValue({});
      await service.upsertProgress('book-1', 'user-1', {
        location: 'epubcfi(/6/4)',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── getProgress ──────────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('returns specific source row when source is provided', async () => {
      const row = { source: ProgressSource.LITARA, percentage: 0.3 };
      mockPrisma.readingProgress.findUnique.mockResolvedValue(row);

      const result = await service.getProgress(
        'book-1',
        'user-1',
        ProgressSource.LITARA,
      );

      expect(mockPrisma.readingProgress.findUnique).toHaveBeenCalledWith({
        where: {
          userId_bookId_source: {
            userId: 'user-1',
            bookId: 'book-1',
            source: ProgressSource.LITARA,
          },
        },
      });
      expect(result).toBe(row);
    });

    it('returns null when specific source row does not exist', async () => {
      mockPrisma.readingProgress.findUnique.mockResolvedValue(null);
      const result = await service.getProgress(
        'book-1',
        'user-1',
        ProgressSource.KOREADER,
      );
      expect(result).toBeNull();
    });

    describe('without source — applies display preference', () => {
      it('returns HIGHEST percentage row when preference is HIGHEST', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue({
          progressDisplaySource: 'HIGHEST',
        });
        const rows = [
          {
            source: ProgressSource.LITARA,
            percentage: 0.3,
            lastSyncedAt: new Date('2024-01-01'),
          },
          {
            source: ProgressSource.KOREADER,
            percentage: 0.7,
            lastSyncedAt: new Date('2024-01-02'),
          },
        ];
        mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result?.source).toBe(ProgressSource.KOREADER);
      });

      it('returns MOST_RECENT row when preference is MOST_RECENT', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue({
          progressDisplaySource: 'MOST_RECENT',
        });
        const rows = [
          {
            source: ProgressSource.LITARA,
            percentage: 0.9,
            lastSyncedAt: new Date('2024-01-03'),
          },
          {
            source: ProgressSource.KOREADER,
            percentage: 0.2,
            lastSyncedAt: new Date('2024-01-01'),
          },
        ];
        mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result?.source).toBe(ProgressSource.LITARA);
      });

      it('returns KOREADER row when preference is KOREADER', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue({
          progressDisplaySource: 'KOREADER',
        });
        const rows = [
          {
            source: ProgressSource.LITARA,
            percentage: 0.9,
            lastSyncedAt: new Date(),
          },
          {
            source: ProgressSource.KOREADER,
            percentage: 0.2,
            lastSyncedAt: new Date(),
          },
        ];
        mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result?.source).toBe(ProgressSource.KOREADER);
      });

      it('returns LITARA row when preference is LITARA', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue({
          progressDisplaySource: 'LITARA',
        });
        const rows = [
          {
            source: ProgressSource.LITARA,
            percentage: 0.4,
            lastSyncedAt: new Date(),
          },
          {
            source: ProgressSource.KOREADER,
            percentage: 0.9,
            lastSyncedAt: new Date(),
          },
        ];
        mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result?.source).toBe(ProgressSource.LITARA);
      });

      it('returns null when no rows exist', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue(null);
        mockPrisma.readingProgress.findMany.mockResolvedValue([]);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result).toBeNull();
      });

      it('defaults to HIGHEST when user has no settings', async () => {
        mockPrisma.userSettings.findUnique.mockResolvedValue(null);
        const rows = [
          {
            source: ProgressSource.LITARA,
            percentage: 0.1,
            lastSyncedAt: new Date(),
          },
          {
            source: ProgressSource.KOREADER,
            percentage: 0.8,
            lastSyncedAt: new Date(),
          },
        ];
        mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

        const result = await service.getProgress('book-1', 'user-1');

        expect(result?.source).toBe(ProgressSource.KOREADER);
      });
    });
  });

  // ─── getAllProgress ────────────────────────────────────────────────────────

  describe('getAllProgress', () => {
    it('returns all rows for the book', async () => {
      const rows = [
        { source: ProgressSource.LITARA, percentage: 0.3 },
        { source: ProgressSource.KOREADER, percentage: 0.7 },
      ];
      mockPrisma.readingProgress.findMany.mockResolvedValue(rows);

      const result = await service.getAllProgress('book-1', 'user-1');

      expect(mockPrisma.readingProgress.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', bookId: 'book-1' },
      });
      expect(result).toBe(rows);
    });
  });

  // ─── resetProgress ────────────────────────────────────────────────────────

  describe('resetProgress', () => {
    it('deletes all sources when no source provided', async () => {
      mockPrisma.readingProgress.deleteMany.mockResolvedValue({ count: 2 });

      await service.resetProgress('book-1', 'user-1');

      expect(mockPrisma.readingProgress.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', bookId: 'book-1' },
      });
    });

    it('deletes only the specified source', async () => {
      mockPrisma.readingProgress.deleteMany.mockResolvedValue({ count: 1 });

      await service.resetProgress('book-1', 'user-1', ProgressSource.LITARA);

      expect(mockPrisma.readingProgress.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          bookId: 'book-1',
          source: ProgressSource.LITARA,
        },
      });
    });

    it('deletes only KOReader source when specified', async () => {
      mockPrisma.readingProgress.deleteMany.mockResolvedValue({ count: 1 });

      await service.resetProgress('book-1', 'user-1', ProgressSource.KOREADER);

      expect(mockPrisma.readingProgress.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          bookId: 'book-1',
          source: ProgressSource.KOREADER,
        },
      });
    });
  });
});
