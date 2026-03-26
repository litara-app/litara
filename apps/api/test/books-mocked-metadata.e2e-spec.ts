import path from 'path';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { LibraryScannerService } from '../src/library/library-scanner.service';
import { MetadataService } from '../src/metadata/metadata.service';
import { DatabaseService } from '../src/database/database.service';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

const EBOOK_DIR = process.env.EBOOK_LIBRARY_PATH!;
const PRIDE_EPUB = path.join(
  EBOOK_DIR,
  'Pride and Prejudice - Jane Austen.epub',
);

const MOCK_METADATA = {
  title: 'Pride and Prejudice',
  authors: ['Jane Austen'],
  description: 'A classic novel.',
  publishedDate: new Date('1813-01-28'),
  publisher: 'T. Egerton',
  language: 'en',
  pageCount: 432,
  isbn13: '9780141439518',
  categories: ['Fiction', 'Romance'],
  genres: ['Literary Fiction'],
  moods: ['Witty'],
  googleBooksId: 'mock-gb-id',
};

describe('Books — Mocked Metadata Provider (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let bookId: string;

  const mockMetadataService = {
    searchFromProvider: jest.fn().mockResolvedValue([MOCK_METADATA]),
    fetchFromProvider: jest.fn().mockResolvedValue(MOCK_METADATA),
    enrichBookForProvider: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LibraryScannerService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => {},
        fullScan: () => Promise.resolve(),
      })
      .overrideProvider(MetadataService)
      .useValue(mockMetadataService)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    app.enableCors();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = moduleRef.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await cleanDatabase(db);
    await createTestUser(db);
    token = await loginAs(app, 'test@test.com', 'password123');

    const library = await db.library.create({ data: { name: 'Test Library' } });
    const author = await db.author.create({ data: { name: 'Jane Austen' } });
    const book = await db.book.create({
      data: {
        libraryId: library.id,
        title: 'Pride and Prejudice',
        files: {
          create: [
            {
              filePath: PRIDE_EPUB,
              format: 'EPUB',
              sizeBytes: BigInt(1024),
              fileHash: 'a'.repeat(64),
            },
          ],
        },
        authors: { create: [{ authorId: author.id }] },
      },
    });
    bookId = book.id;
  });

  describe('GET /api/v1/books/:id/search-metadata', () => {
    it('returns metadata result from the provider', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/books/${bookId}/search-metadata?provider=google-books`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('title', 'Pride and Prejudice');
      expect(res.body[0].authors).toContain('Jane Austen');
      expect(mockMetadataService.searchFromProvider).toHaveBeenCalledWith(
        'google-books',
        expect.objectContaining({ title: 'Pride and Prejudice' }),
      );
    });

    it('passes isbn override when provided', async () => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/books/${bookId}/search-metadata?provider=open-library&isbn=9780141439518`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(mockMetadataService.searchFromProvider).toHaveBeenCalledWith(
        'open-library',
        expect.objectContaining({ isbn13: '9780141439518' }),
      );
    });

    it('returns null when provider finds nothing', async () => {
      mockMetadataService.searchFromProvider.mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/books/${bookId}/search-metadata?provider=open-library&title=NotABook`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/v1/books/:id/apply-metadata', () => {
    it('calls enrichBookForProvider and returns updated book detail', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/books/${bookId}/apply-metadata?provider=google-books`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(mockMetadataService.enrichBookForProvider).toHaveBeenCalledWith(
        bookId,
        'google-books',
        expect.objectContaining({ title: 'Pride and Prejudice' }),
      );
      expect(res.body).toHaveProperty('id', bookId);
    });
  });
});
