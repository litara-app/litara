// Stub out heavy native deps that don't resolve in unit test context
jest.mock('epub2', () => ({}), { virtual: true });
jest.mock('@litara/mobi-parser', () => ({}), { virtual: true });
jest.mock('@litara/cbz-parser', () => ({}), { virtual: true });
jest.mock('../common/extract-file-metadata', () => ({
  extractFileMetadata: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LibraryWriteService } from './library-write.service';
import { DatabaseService } from '../database/database.service';
import { DiskWriteGuardService } from '../common/disk-write-guard.service';
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
