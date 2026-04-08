// Stub out heavy native deps that don't resolve in unit test context
jest.mock('epub2', () => ({}), { virtual: true });
jest.mock('@litara/mobi-parser', () => ({}), { virtual: true });
jest.mock('@litara/cbz-parser', () => ({}), { virtual: true });
jest.mock('../common/extract-file-metadata', () => ({
  extractFileMetadata: jest.fn(),
}));
jest.mock('fs');

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PendingBookStatus } from '@prisma/client';
import { LibraryWriteService } from './library-write.service';
import { DatabaseService } from '../database/database.service';
import { DiskWriteGuardService } from '../common/disk-write-guard.service';
import { extractFileMetadata } from '../common/extract-file-metadata';
import * as fs from 'fs';
import * as path from 'path';

const root = '/library';

describe('LibraryWriteService.computeTargetPath', () => {
  let service: LibraryWriteService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LibraryWriteService,
        { provide: DatabaseService, useValue: {} },
        { provide: DiskWriteGuardService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: () => root },
        },
      ],
    }).compile();

    service = module.get(LibraryWriteService);
  });

  it('author/series/title when all metadata present', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: ['Brandon Sanderson'],
      seriesName: 'The Stormlight Archive',
      title: 'The Way of Kings',
      originalFilename: 'twok.epub',
      ext: '.epub',
    });
    expect(result).toBe(
      path.join(
        root,
        'Brandon Sanderson',
        'The Stormlight Archive',
        'The Way of Kings.epub',
      ),
    );
  });

  it('author/title when no series', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: ['N.K. Jemisin'],
      seriesName: null,
      title: 'The Fifth Season',
      originalFilename: 'fifth.epub',
      ext: '.epub',
    });
    expect(result).toBe(
      path.join(root, 'N.K. Jemisin', 'The Fifth Season.epub'),
    );
  });

  it('unknown/title when no author', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: [],
      seriesName: null,
      title: 'Untitled Anthology',
      originalFilename: 'anth.mobi',
      ext: '.mobi',
    });
    expect(result).toBe(path.join(root, 'unknown', 'Untitled Anthology.mobi'));
  });

  it('unknown/original-filename when no metadata', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: [],
      seriesName: null,
      title: null,
      originalFilename: 'mystery-book.epub',
      ext: '.epub',
    });
    expect(result).toBe(path.join(root, 'unknown', 'mystery-book.epub'));
  });

  it('uses first author only for multi-author books', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: ['Terry Pratchett', 'Neil Gaiman'],
      seriesName: null,
      title: 'Good Omens',
      originalFilename: 'good-omens.epub',
      ext: '.epub',
    });
    expect(result).toBe(path.join(root, 'Terry Pratchett', 'Good Omens.epub'));
  });

  it('strips illegal characters from path segments', () => {
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: ['Author: One'],
      seriesName: null,
      title: 'Title/With?Illegal*Chars',
      originalFilename: 'book.epub',
      ext: '.epub',
    });
    // Check each segment (excluding the root) has no illegal chars
    const segments = result.split(path.sep).slice(1); // skip root
    const illegalInSegment = /[<>:"/|?*]/; // backslash excluded — it's the separator
    for (const seg of segments) {
      expect(seg).not.toMatch(illegalInSegment);
    }
  });

  it('truncates very long segments to 200 chars', () => {
    const longName = 'A'.repeat(300);
    const result = service.computeTargetPath({
      libraryRoot: root,
      authors: [longName],
      seriesName: null,
      title: longName,
      originalFilename: 'book.epub',
      ext: '.epub',
    });
    const parts = result.split(path.sep);
    for (const part of parts.slice(1)) {
      expect(part.length).toBeLessThanOrEqual(205); // ext + 200
    }
  });
});

// ---------------------------------------------------------------------------
// Shared factory for tests that need prisma / diskWriteGuard mocks
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    pendingBook: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    book: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    author: { upsert: jest.fn().mockResolvedValue({ id: 'a1' }) },
    bookAuthor: { upsert: jest.fn().mockResolvedValue({}) },
    series: { upsert: jest.fn().mockResolvedValue({ id: 's1' }) },
    seriesBook: { upsert: jest.fn().mockResolvedValue({}) },
    bookFile: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeGuardMock(writable = true) {
  return {
    probeLibraryWritable: jest.fn().mockReturnValue(writable),
    assertDiskWritesAllowed: jest.fn().mockResolvedValue(undefined),
  };
}

async function buildService(prisma: object, guard: object) {
  const module = await Test.createTestingModule({
    providers: [
      LibraryWriteService,
      { provide: DatabaseService, useValue: prisma },
      { provide: DiskWriteGuardService, useValue: guard },
      { provide: ConfigService, useValue: { get: () => root } },
    ],
  }).compile();
  return module.get(LibraryWriteService);
}

// ---------------------------------------------------------------------------

describe('LibraryWriteService.extractMetadataFromFile', () => {
  let service: LibraryWriteService;

  beforeEach(async () => {
    service = await buildService({}, {});
  });

  it('returns metadata from extractFileMetadata on success', async () => {
    const meta = { title: 'My Book', authors: ['Author One'] };
    (extractFileMetadata as jest.Mock).mockResolvedValue(meta);
    await expect(
      service.extractMetadataFromFile('/some/my-book.epub'),
    ).resolves.toEqual(meta);
  });

  it('falls back to filename-derived title and empty authors on error', async () => {
    (extractFileMetadata as jest.Mock).mockRejectedValue(
      new Error('parse error'),
    );
    const result = await service.extractMetadataFromFile('/some/my-book.epub');
    expect(result.title).toBe('my-book');
    expect(result.authors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('LibraryWriteService.isVolumeReadOnly', () => {
  it('returns true when diskWriteGuard reports not writable', async () => {
    const service = await buildService({}, makeGuardMock(false));
    expect(service.isVolumeReadOnly()).toBe(true);
  });

  it('returns false when diskWriteGuard reports writable', async () => {
    const service = await buildService({}, makeGuardMock(true));
    expect(service.isVolumeReadOnly()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('LibraryWriteService.approvePendingBook — error paths', () => {
  let service: LibraryWriteService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let guard: ReturnType<typeof makeGuardMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    guard = makeGuardMock();
    service = await buildService(prisma, guard);
  });

  it('throws NotFoundException when pending book does not exist', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue(null);
    await expect(service.approvePendingBook('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException when book status is APPROVED', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue({
      id: '1',
      status: PendingBookStatus.APPROVED,
    });
    await expect(service.approvePendingBook('1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws ConflictException when book status is REJECTED', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue({
      id: '1',
      status: PendingBookStatus.REJECTED,
    });
    await expect(service.approvePendingBook('1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws ForbiddenException when library volume is read-only', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue({
      id: '1',
      status: PendingBookStatus.PENDING,
      stagedFilePath: '/drop/book.epub',
      authors: '[]',
      title: 'Test',
      seriesName: null,
      originalFilename: 'book.epub',
    });
    guard.probeLibraryWritable.mockReturnValue(false);
    await expect(service.approvePendingBook('1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('sets status COLLISION and throws when target file exists', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue({
      id: '1',
      status: PendingBookStatus.PENDING,
      stagedFilePath: '/drop/book.epub',
      authors: '["Author"]',
      title: 'My Book',
      seriesName: null,
      originalFilename: 'book.epub',
    });
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    await expect(service.approvePendingBook('1')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.pendingBook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PendingBookStatus.COLLISION,
        }) as unknown,
      }) as unknown,
    );
  });
});

// ---------------------------------------------------------------------------

describe('LibraryWriteService.approveOverwrite — error paths', () => {
  let service: LibraryWriteService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    service = await buildService(prisma, makeGuardMock());
  });

  it('throws NotFoundException when pending book does not exist', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue(null);
    await expect(service.approveOverwrite('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException when status is not COLLISION', async () => {
    prisma.pendingBook.findUnique.mockResolvedValue({
      id: '1',
      status: PendingBookStatus.PENDING,
    });
    await expect(service.approveOverwrite('1')).rejects.toThrow(
      ConflictException,
    );
  });
});
