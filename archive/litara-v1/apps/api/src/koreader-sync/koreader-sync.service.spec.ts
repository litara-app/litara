import { Test } from '@nestjs/testing';
import { ProgressSource } from '@prisma/client';
import { KoReaderSyncService } from './koreader-sync.service';
import { DatabaseService } from '../database/database.service';

const mockDb = {
  bookFile: { findFirst: jest.fn() },
  readingProgress: { upsert: jest.fn(), findUnique: jest.fn() },
  book: { update: jest.fn() },
};

const mockCredential = {
  id: 'cred-1',
  username: 'alice',
  passwordHash: 'hash',
  hashVersion: 2,
  userId: 'user-1',
  createdAt: new Date(),
};

describe('KoReaderSyncService', () => {
  let service: KoReaderSyncService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        KoReaderSyncService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();
    service = module.get(KoReaderSyncService);
    jest.clearAllMocks();
  });

  describe('authorizeUser', () => {
    it('returns authorized OK', () => {
      const result = service.authorizeUser(mockCredential);
      expect(result).toEqual({ authorized: 'OK' });
    });
  });

  describe('updateProgress', () => {
    it('upserts ReadingProgress when BookFile found', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue({
        id: 'bf-1',
        bookId: 'book-1',
      });
      mockDb.readingProgress.upsert.mockResolvedValue({});
      mockDb.book.update.mockResolvedValue({});

      const result = await service.updateProgress(mockCredential, {
        document: 'abc123',
        percentage: 0.5,
        progress: '100',
        device: 'Kindle',
        device_id: 'k1',
      });

      expect(mockDb.bookFile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { koReaderHash: 'abc123' } }),
      );
      expect(mockDb.readingProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_bookId_source: {
              userId: 'user-1',
              bookId: 'book-1',
              source: ProgressSource.KOREADER,
            },
          },
          create: expect.objectContaining({
            source: ProgressSource.KOREADER,
          }) as unknown,
        }),
      );
      expect(mockDb.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: { updatedAt: expect.any(Date) as unknown },
      });
      expect(result.document).toBe('abc123');
      expect(typeof result.timestamp).toBe('number');
    });

    it('skips upsert when BookFile not found', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue(null);

      const result = await service.updateProgress(mockCredential, {
        document: 'unknown',
        percentage: 0.1,
        progress: '5',
        device: 'Kobo',
      });

      expect(mockDb.readingProgress.upsert).not.toHaveBeenCalled();
      expect(result.document).toBe('unknown');
    });
  });

  describe('getProgress', () => {
    it('returns empty object when BookFile not found', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue(null);
      const result = await service.getProgress(mockCredential, 'notfound');
      expect(result).toEqual({});
    });

    it('returns empty object when no ReadingProgress exists', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue({ bookId: 'book-1' });
      mockDb.readingProgress.findUnique.mockResolvedValue(null);

      const result = await service.getProgress(mockCredential, 'abc');
      expect(result).toEqual({});
    });

    it('queries the KOREADER source row', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue({ bookId: 'book-1' });
      mockDb.readingProgress.findUnique.mockResolvedValue(null);

      await service.getProgress(mockCredential, 'abc');

      expect(mockDb.readingProgress.findUnique).toHaveBeenCalledWith({
        where: {
          userId_bookId_source: {
            userId: 'user-1',
            bookId: 'book-1',
            source: ProgressSource.KOREADER,
          },
        },
      });
    });

    it('returns progress fields when ReadingProgress exists', async () => {
      mockDb.bookFile.findFirst.mockResolvedValue({ bookId: 'book-1' });
      mockDb.readingProgress.findUnique.mockResolvedValue({
        percentage: 0.42,
        koReaderProgress: 'epubcfi(/6/2)',
        koReaderDevice: 'Kindle',
        koReaderDeviceId: 'k1',
        koReaderTimestamp: 1700000000,
      });

      const result = await service.getProgress(mockCredential, 'abc');
      expect(result.percentage).toBeCloseTo(0.42);
      expect(result.progress).toBe('epubcfi(/6/2)');
      expect(result.device).toBe('Kindle');
      expect(result.device_id).toBe('k1');
      expect(result.timestamp).toBe(1700000000);
    });
  });
});
