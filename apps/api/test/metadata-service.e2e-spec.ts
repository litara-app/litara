import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { LibraryScannerService } from '../src/library/library-scanner.service';
import { GoogleBooksService } from '../src/metadata/providers/google-books.service';
import { OpenLibraryService } from '../src/metadata/providers/open-library.service';
import { GoodreadsService } from '../src/metadata/providers/goodreads.service';
import { MetadataService } from '../src/metadata/metadata.service';
import { DatabaseService } from '../src/database/database.service';
import { cleanDatabase } from './helpers/db.helper';

const MOCK_RESULT = {
  title: 'Test Book Title',
  subtitle: 'A Subtitle',
  authors: ['Author One', 'Author Two'],
  description: 'A test description.',
  publishedDate: new Date('2020-06-15'),
  publisher: 'Test Publisher',
  language: 'en',
  pageCount: 300,
  isbn13: '9781234567890',
  isbn10: '1234567890',
  categories: ['Fiction', 'Thriller'],
  genres: ['Literary Fiction'],
  moods: ['Dark'],
  googleBooksId: 'gb-123',
  openLibraryId: '/works/OL123',
  goodreadsId: 'gr-456',
  asin: 'B00TEST',
  goodreadsRating: 4.2,
  seriesName: 'Test Series',
  seriesPosition: 1,
  seriesTotalBooks: 3,
};

describe('MetadataService (e2e — mocked providers)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let metadataService: MetadataService;
  let moduleRef: TestingModule;

  const mockGoogleBooks = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
  };
  const mockOpenLibrary = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
  };
  const mockGoodreads = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LibraryScannerService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => {},
        fullScan: () => Promise.resolve(),
      })
      .overrideProvider(GoogleBooksService)
      .useValue(mockGoogleBooks)
      .overrideProvider(OpenLibraryService)
      .useValue(mockOpenLibrary)
      .overrideProvider(GoodreadsService)
      .useValue(mockGoodreads)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    app.enableCors();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = moduleRef.get(DatabaseService);
    metadataService = moduleRef.get(MetadataService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await cleanDatabase(db);
  });

  async function seedBook(opts?: { lockedFields?: string[] }) {
    const library = await db.library.create({ data: { name: 'Test Library' } });
    return db.book.create({
      data: {
        libraryId: library.id,
        title: 'Original Title',
        lockedFields: opts?.lockedFields
          ? JSON.stringify(opts.lockedFields)
          : '[]',
        files: {
          create: [
            {
              filePath: '/fake/book.epub',
              format: 'EPUB',
              sizeBytes: BigInt(1024),
              fileHash: 'a'.repeat(64),
            },
          ],
        },
      },
    });
  }

  // ── enrichBook ────────────────────────────────────────────────────────────

  describe('enrichBook', () => {
    it('fetches metadata and applies all scalar fields to the book', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, {
        title: 'Original Title',
        authors: ['Author One'],
      });

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Test Book Title');
      expect(updated?.subtitle).toBe('A Subtitle');
      expect(updated?.description).toBe('A test description.');
      expect(updated?.publisher).toBe('Test Publisher');
      expect(updated?.language).toBe('en');
      expect(updated?.pageCount).toBe(300);
      expect(updated?.isbn13).toBe('9781234567890');
      expect(updated?.isbn10).toBe('1234567890');
      expect(updated?.googleBooksId).toBe('gb-123');
      expect(updated?.openLibraryId).toBe('/works/OL123');
      expect(updated?.goodreadsId).toBe('gr-456');
      expect(updated?.amazonId).toBe('B00TEST');
      expect(updated?.goodreadsRating).toBeCloseTo(4.2);
    });

    it('upserts authors, tags, genres, moods, and series', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, { title: 'T', authors: ['A'] });

      const full = await db.book.findUnique({
        where: { id: book.id },
        include: {
          authors: { include: { author: true } },
          tags: true,
          genres: true,
          moods: true,
          series: { include: { series: true } },
        },
      });

      expect(full?.authors.map((a) => a.author.name)).toContain('Author One');
      expect(full?.authors.map((a) => a.author.name)).toContain('Author Two');
      expect(full?.tags.map((t) => t.name)).toContain('Fiction');
      expect(full?.tags.map((t) => t.name)).toContain('Thriller');
      expect(full?.genres.map((g) => g.name)).toContain('Literary Fiction');
      expect(full?.moods.map((m) => m.name)).toContain('Dark');
      expect(full?.series[0].series.name).toBe('Test Series');
      expect(full?.series[0].sequence).toBe(1);
    });

    it('uses isbn13 path via fetchMetadata when book has isbn13', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, {
        title: 'T',
        authors: ['A'],
        isbn13: '9781234567890',
      });

      expect(mockGoogleBooks.searchByIsbn).toHaveBeenCalledWith(
        '9781234567890',
      );
      expect(mockGoogleBooks.searchByTitleAuthor).not.toHaveBeenCalled();
    });

    it('falls back to openLibrary when google returns null (isbn path)', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(null);
      mockOpenLibrary.searchByIsbn.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, {
        title: 'T',
        authors: ['A'],
        isbn13: '9781234567890',
      });

      expect(mockOpenLibrary.searchByIsbn).toHaveBeenCalledWith(
        '9781234567890',
      );
      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Test Book Title');
    });

    it('falls back to openLibrary when google returns null (title/author path)', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, {
        title: 'My Book',
        authors: ['Jane'],
      });

      expect(mockOpenLibrary.searchByTitleAuthor).toHaveBeenCalledWith(
        'My Book',
        'Jane',
      );
      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Test Book Title');
    });

    it('is a no-op when both providers return null', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);

      await metadataService.enrichBook(book.id, {
        title: 'Unknown',
        authors: [],
      });

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Original Title');
    });

    it('swallows errors and does not throw', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockRejectedValueOnce(
        new Error('Network failure'),
      );

      await expect(
        metadataService.enrichBook(book.id, { title: 'T', authors: ['A'] }),
      ).resolves.toBeUndefined();
    });
  });

  // ── locked fields ────────────────────────────────────────────────────────

  describe('applyResult with locked fields', () => {
    it('does not overwrite fields that are locked', async () => {
      const book = await seedBook({
        lockedFields: ['title', 'authors', 'isbn13'],
      });
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, {
        title: 'Original Title',
        authors: ['A'],
      });

      const updated = await db.book.findUnique({
        where: { id: book.id },
        include: { authors: { include: { author: true } } },
      });
      expect(updated?.title).toBe('Original Title');
      expect(updated?.isbn13).toBeNull();
      expect(updated?.authors).toHaveLength(0);
      // non-locked fields still applied
      expect(updated?.publisher).toBe('Test Publisher');
    });

    it('does not apply locked tags, genres, moods', async () => {
      const book = await seedBook({
        lockedFields: ['tags', 'genres', 'moods'],
      });
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, { title: 'T', authors: ['A'] });

      const full = await db.book.findUnique({
        where: { id: book.id },
        include: { tags: true, genres: true, moods: true },
      });
      expect(full?.tags).toHaveLength(0);
      expect(full?.genres).toHaveLength(0);
      expect(full?.moods).toHaveLength(0);
    });

    it('does not apply series when seriesName is locked', async () => {
      const book = await seedBook({ lockedFields: ['seriesName'] });
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBook(book.id, { title: 'T', authors: ['A'] });

      const full = await db.book.findUnique({
        where: { id: book.id },
        include: { series: true },
      });
      expect(full?.series).toHaveLength(0);
    });
  });

  // ── isbn10-only path ─────────────────────────────────────────────────────

  it('applies isbn10 when result has isbn10 but no isbn13', async () => {
    const book = await seedBook();
    const resultIsbn10Only = {
      ...MOCK_RESULT,
      isbn10: '1234567890',
      isbn13: undefined,
    };
    mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(resultIsbn10Only);

    await metadataService.enrichBook(book.id, { title: 'T', authors: ['A'] });

    const updated = await db.book.findUnique({ where: { id: book.id } });
    expect(updated?.isbn10).toBe('1234567890');
    expect(updated?.isbn13).toBeNull();
  });

  // ── fetchFromProvider ────────────────────────────────────────────────────

  describe('fetchFromProvider', () => {
    it('routes to google-books by title/author', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'google-books' as any,
        {
          title: 'Pride and Prejudice',
          authors: ['Jane Austen'],
        },
      );

      expect(mockGoogleBooks.searchByTitleAuthor).toHaveBeenCalledWith(
        'Pride and Prejudice',
        'Jane Austen',
      );
      expect(result?.title).toBe('Test Book Title');
      void book;
    });

    it('routes to google-books by isbn', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'google-books' as any,
        {
          title: 'T',
          authors: ['A'],
          isbn13: '9781234567890',
        },
      );

      expect(mockGoogleBooks.searchByIsbn).toHaveBeenCalledWith(
        '9781234567890',
      );
      expect(result).toBeTruthy();
      void book;
    });

    it('routes to open-library by title/author', async () => {
      const book = await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'open-library' as any,
        {
          title: 'Dune',
          authors: ['Frank Herbert'],
        },
      );

      expect(mockOpenLibrary.searchByTitleAuthor).toHaveBeenCalledWith(
        'Dune',
        'Frank Herbert',
      );
      expect(result).toBeTruthy();
      void book;
    });

    it('routes to open-library by isbn', async () => {
      mockOpenLibrary.searchByIsbn.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'open-library' as any,
        {
          title: 'T',
          authors: ['A'],
          isbn13: '9780000000000',
        },
      );

      expect(mockOpenLibrary.searchByIsbn).toHaveBeenCalledWith(
        '9780000000000',
      );
      expect(result).toBeTruthy();
    });

    it('routes to goodreads by title/author', async () => {
      mockGoodreads.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'goodreads' as any,
        {
          title: 'Some Book',
          authors: ['Some Author'],
        },
      );

      expect(mockGoodreads.searchByTitleAuthor).toHaveBeenCalledWith(
        'Some Book',
        'Some Author',
      );
      expect(result).toBeTruthy();
    });

    it('routes to goodreads by isbn', async () => {
      mockGoodreads.searchByIsbn.mockResolvedValueOnce(MOCK_RESULT);

      const result = await metadataService.fetchFromProvider(
        'goodreads' as any,
        {
          title: 'T',
          authors: ['A'],
          isbn13: '9780000000001',
        },
      );

      expect(mockGoodreads.searchByIsbn).toHaveBeenCalledWith('9780000000001');
      expect(result).toBeTruthy();
    });

    it('returns null when provider finds nothing', async () => {
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(null);

      const result = await metadataService.fetchFromProvider(
        'google-books' as any,
        {
          title: 'NotABook',
          authors: [],
        },
      );

      expect(result).toBeNull();
    });
  });

  // ── enrichBookForProvider ────────────────────────────────────────────────

  describe('enrichBookForProvider', () => {
    it('applies metadata from the specified provider', async () => {
      const book = await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(MOCK_RESULT);

      await metadataService.enrichBookForProvider(
        book.id,
        'open-library' as any,
        {
          title: 'T',
          authors: ['A'],
        },
      );

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Test Book Title');
      expect(updated?.openLibraryId).toBe('/works/OL123');
    });

    it('is a no-op when provider returns null', async () => {
      const book = await seedBook();
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(null);

      await metadataService.enrichBookForProvider(
        book.id,
        'google-books' as any,
        {
          title: 'Unknown',
          authors: [],
        },
      );

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Original Title');
    });
  });
});
