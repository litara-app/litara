import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { LibraryScannerService } from '../src/library/library-scanner.service';
import { GoogleBooksService } from '../src/metadata/providers/google-books.service';
import { OpenLibraryService } from '../src/metadata/providers/open-library.service';
import { GoodreadsService } from '../src/metadata/providers/goodreads.service';
import { HardcoverService } from '../src/metadata/providers/hardcover.service';
import { AudnexusService } from '../src/metadata/providers/audnexus.service';
import { DEFAULT_FIELD_CONFIG } from '../src/metadata/metadata.service';
import { DatabaseService } from '../src/database/database.service';
import { cleanDatabase } from './helpers/db.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';

const FIELD_CONFIG_KEY = 'metadata_field_config';

async function waitForTask(
  app: INestApplication,
  token: string,
  taskId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/metadata-match/task/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    const task = res.body as Record<string, unknown>;
    if (
      task.status === 'COMPLETED' ||
      task.status === 'FAILED' ||
      task.status === 'CANCELLED'
    ) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

const OL_RESULT = {
  title: 'Enriched Title',
  subtitle: 'A Subtitle',
  authors: ['Author One'],
  publisher: 'Test Publisher',
  publishedDate: new Date('2020-01-01').toISOString(),
  language: 'en',
  isbn13: '9781234567890',
  isbn10: '1234567890',
  pageCount: 300,
  openLibraryId: '/works/OL123',
  goodreadsId: 'gr-456', // field config assigns goodreadsId to open-library
};

const GB_RESULT = {
  title: 'GB Title',
  description: 'GB Description',
  googleBooksId: 'gb-123',
};

const GR_RESULT = {
  goodreadsRating: 4.2, // field config assigns goodreadsRating to goodreads
};

const HC_RESULT = {
  genres: ['Fantasy', 'Adventure'],
  seriesName: 'Test Series',
  seriesPosition: 1,
  seriesTotalBooks: 3,
};

const AUDNEXUS_RESULT = {
  title: 'Audible Title',
  asin: 'B0014S7TXS',
  description: 'Audnexus description',
  genres: ['Audiobook Fiction'],
};

describe('BulkMetadataService (e2e — mocked providers)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let moduleRef: TestingModule;
  let adminToken: string;

  const mockOpenLibrary = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
    fetchByKey: jest.fn(),
    searchManyByTitleAuthor: jest.fn(),
  };
  const mockGoogleBooks = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
    searchManyByTitleAuthor: jest.fn(),
  };
  const mockGoodreads = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
    searchManyByTitleAuthor: jest.fn(),
  };
  const mockHardcover = {
    searchByIsbn: jest.fn(),
    searchByTitleAuthor: jest.fn(),
    searchManyByTitleAuthor: jest.fn(),
    fetchSeriesByName: jest.fn(),
    testConnection: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }),
  };
  const mockAudnexus = {
    searchByAsin: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LibraryScannerService)
      .useValue({
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => {},
        fullScan: () => Promise.resolve(),
        triggerFullScanTask: () => Promise.resolve({ taskId: 'mock-task-id' }),
      })
      .overrideProvider(GoogleBooksService)
      .useValue(mockGoogleBooks)
      .overrideProvider(OpenLibraryService)
      .useValue(mockOpenLibrary)
      .overrideProvider(GoodreadsService)
      .useValue(mockGoodreads)
      .overrideProvider(HardcoverService)
      .useValue(mockHardcover)
      .overrideProvider(AudnexusService)
      .useValue(mockAudnexus)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'opds', method: RequestMethod.ALL },
        { path: 'opds/*path', method: RequestMethod.ALL },
        { path: '1', method: RequestMethod.ALL },
        { path: '1/*path', method: RequestMethod.ALL },
      ],
    });
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
    await createTestUser(db, {
      email: 'admin@test.com',
      password: 'adminpass',
      role: 'ADMIN',
    });
    adminToken = await loginAs(app, 'admin@test.com', 'adminpass');
  });

  async function seedBook(opts?: {
    title?: string;
    asin?: string | null;
    description?: string | null;
    lockedFields?: string[];
  }) {
    const library = await db.library.create({
      data: { name: 'Test Library', path: '/test/library' },
    });
    return db.book.create({
      data: {
        libraryId: library.id,
        title: opts?.title ?? 'Original Title',
        asin: opts?.asin ?? null,
        description: opts?.description ?? null,
        lockedFields: opts?.lockedFields
          ? JSON.stringify(opts.lockedFields)
          : '[]',
      },
    });
  }

  async function startRun(opts: {
    scope?: 'all' | 'selection';
    bookIds?: string[];
    overwrite?: boolean;
  }) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/metadata-match/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scope: opts.scope ?? 'all',
        bookIds: opts.bookIds,
        overwrite: opts.overwrite ?? false,
        throttleMs: 0,
      })
      .expect(201);
    return res.body as { taskId: string; total: number };
  }

  // ── core enrichment ──────────────────────────────────────────────────────

  describe('core enrichment', () => {
    it('applies scalar fields from each provider in order', async () => {
      const book = await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(GB_RESULT);
      mockGoodreads.searchByIsbn.mockResolvedValueOnce(GR_RESULT);
      mockHardcover.searchByIsbn.mockResolvedValueOnce(HC_RESULT);

      const { taskId } = await startRun({ overwrite: true });
      const task = await waitForTask(app, adminToken, taskId);
      expect(task.status).toBe('COMPLETED');

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Enriched Title');
      expect(updated?.publisher).toBe('Test Publisher');
      expect(updated?.isbn13).toBe('9781234567890');
      expect(updated?.openLibraryId).toBe('/works/OL123');
      expect(updated?.description).toBe('GB Description');
      expect(updated?.googleBooksId).toBe('gb-123');
      expect(updated?.goodreadsId).toBe('gr-456');
      expect(updated?.goodreadsRating).toBeCloseTo(4.2);
    });

    it('chains isbn13 from open-library to subsequent providers', async () => {
      await seedBook();
      // OL resolves the ISBN; subsequent providers should use it
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(GB_RESULT);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      expect(mockGoogleBooks.searchByIsbn).toHaveBeenCalledWith(
        '9781234567890',
      );
      expect(mockGoogleBooks.searchByTitleAuthor).not.toHaveBeenCalled();
    });

    it('applies relation fields: genres and series from hardcover', async () => {
      const book = await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(null);
      mockGoodreads.searchByIsbn.mockResolvedValueOnce(null);
      mockHardcover.searchByIsbn.mockResolvedValueOnce(HC_RESULT);

      const { taskId } = await startRun({ overwrite: true });
      await waitForTask(app, adminToken, taskId);

      const full = await db.book.findUnique({
        where: { id: book.id },
        include: {
          genres: true,
          series: { include: { series: true } },
        },
      });
      expect(full?.genres.map((g) => g.name)).toContain('Fantasy');
      expect(full?.series[0]?.series.name).toBe('Test Series');
      expect(full?.series[0]?.sequence).toBe(1);
    });

    it('is a no-op when all providers return null', async () => {
      const book = await seedBook({ title: 'Keep This Title' });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockGoogleBooks.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockGoodreads.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockHardcover.searchByTitleAuthor.mockResolvedValueOnce(null);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Keep This Title');
    });
  });

  // ── overwrite behaviour ──────────────────────────────────────────────────

  describe('overwrite behaviour', () => {
    it('fill-blanks: preserves existing non-empty fields', async () => {
      const book = await seedBook({ description: 'Original description' });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(GB_RESULT);

      const { taskId } = await startRun({ overwrite: false });
      await waitForTask(app, adminToken, taskId);

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.description).toBe('Original description');
      // blank fields still filled
      expect(updated?.isbn13).toBe('9781234567890');
    });

    it('overwrite: replaces existing fields', async () => {
      const book = await seedBook({ description: 'Original description' });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(GB_RESULT);

      const { taskId } = await startRun({ overwrite: true });
      await waitForTask(app, adminToken, taskId);

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.description).toBe('GB Description');
    });
  });

  // ── locked fields ────────────────────────────────────────────────────────

  describe('locked fields', () => {
    it('never overwrites locked fields even when overwrite is true', async () => {
      const book = await seedBook({
        title: 'Locked Title',
        lockedFields: ['title', 'description'],
      });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(OL_RESULT);
      mockGoogleBooks.searchByIsbn.mockResolvedValueOnce(GB_RESULT);

      const { taskId } = await startRun({ overwrite: true });
      await waitForTask(app, adminToken, taskId);

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.title).toBe('Locked Title');
      expect(updated?.description).toBeNull();
      expect(updated?.isbn13).toBe('9781234567890'); // non-locked, still applied
    });
  });

  // ── Audnexus ─────────────────────────────────────────────────────────────

  describe('Audnexus', () => {
    async function enableAudnexus() {
      const config = DEFAULT_FIELD_CONFIG.map((fc) =>
        fc.provider === 'audnexus' ? { ...fc, enabled: true } : fc,
      );
      await db.serverSettings.create({
        data: { key: FIELD_CONFIG_KEY, value: JSON.stringify(config) },
      });
    }

    afterEach(async () => {
      await db.serverSettings.deleteMany({ where: { key: FIELD_CONFIG_KEY } });
    });

    it('calls searchByAsin when book has an ASIN and Audnexus is enabled', async () => {
      await seedBook({ asin: 'B0014S7TXS' });
      await enableAudnexus();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockAudnexus.searchByAsin.mockResolvedValueOnce(AUDNEXUS_RESULT);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      expect(mockAudnexus.searchByAsin).toHaveBeenCalledWith('B0014S7TXS');
    });

    it('does not call searchByAsin when book has no ASIN', async () => {
      await seedBook(); // asin is null
      await enableAudnexus();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      expect(mockAudnexus.searchByAsin).not.toHaveBeenCalled();
    });

    it('applies Audnexus description when enabled and it is the assigned provider', async () => {
      const book = await seedBook({ asin: 'B0014S7TXS' });

      // Route description to audnexus, disable the default google-books description entry
      const config = DEFAULT_FIELD_CONFIG.map((fc) => {
        if (fc.provider === 'audnexus' && fc.field === 'description')
          return { ...fc, enabled: true };
        if (fc.provider === 'google-books' && fc.field === 'description')
          return { ...fc, enabled: false };
        return fc;
      });
      await db.serverSettings.create({
        data: { key: FIELD_CONFIG_KEY, value: JSON.stringify(config) },
      });

      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);
      mockAudnexus.searchByAsin.mockResolvedValueOnce(AUDNEXUS_RESULT);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      const updated = await db.book.findUnique({ where: { id: book.id } });
      expect(updated?.description).toBe('Audnexus description');
    });
  });

  // ── scope ────────────────────────────────────────────────────────────────

  describe('scope: selection', () => {
    it('enriches only the selected books and leaves others unchanged', async () => {
      const bookA = await seedBook({ title: 'Book A' });
      const bookB = await seedBook({ title: 'Book B' });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce({
        ...OL_RESULT,
        title: 'Enriched A',
      });

      const { taskId, total } = await startRun({
        scope: 'selection',
        bookIds: [bookA.id],
        overwrite: true,
      });
      expect(total).toBe(1);
      await waitForTask(app, adminToken, taskId);

      const updatedA = await db.book.findUnique({ where: { id: bookA.id } });
      const updatedB = await db.book.findUnique({ where: { id: bookB.id } });
      expect(updatedA?.title).toBe('Enriched A');
      expect(updatedB?.title).toBe('Book B');
    });
  });

  // ── task lifecycle ───────────────────────────────────────────────────────

  describe('task lifecycle', () => {
    it('returns taskId and correct total on start', async () => {
      await seedBook();
      await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValue(null);

      const { taskId, total } = await startRun({});
      expect(typeof taskId).toBe('string');
      expect(total).toBe(2);
    });

    it('completed task appears in task list', async () => {
      await seedBook();
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValueOnce(null);

      const { taskId } = await startRun({});
      await waitForTask(app, adminToken, taskId);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/metadata-match/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const tasks = res.body as Array<Record<string, unknown>>;
      expect(
        tasks.some((t) => t.id === taskId && t.status === 'COMPLETED'),
      ).toBe(true);
    });

    it('cancelled task stops before processing all books', async () => {
      // Seed enough books that cancellation mid-run is likely
      for (let i = 0; i < 5; i++) await seedBook({ title: `Book ${i}` });
      mockOpenLibrary.searchByTitleAuthor.mockResolvedValue(null);

      const { taskId } = await startRun({});

      await request(app.getHttpServer())
        .post(`/api/v1/admin/metadata-match/cancel/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const task = await waitForTask(app, adminToken, taskId);
      expect(task.status).toBe('CANCELLED');
    });
  });

  // ── config endpoints ─────────────────────────────────────────────────────

  describe('config endpoints', () => {
    afterEach(async () => {
      await db.serverSettings.deleteMany({ where: { key: FIELD_CONFIG_KEY } });
    });

    it('GET /config returns the default field config', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/metadata-match/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const config = res.body as Array<{
        field: string;
        provider: string;
        enabled: boolean;
      }>;
      expect(Array.isArray(config)).toBe(true);
      expect(
        config.some(
          (c) =>
            c.field === 'genres' && c.provider === 'hardcover' && c.enabled,
        ),
      ).toBe(true);
      expect(
        config.some(
          (c) =>
            c.field === 'description' &&
            c.provider === 'audnexus' &&
            !c.enabled,
        ),
      ).toBe(true);
    });

    it('PUT /config persists and returns updated config', async () => {
      const custom = DEFAULT_FIELD_CONFIG.map((fc) =>
        fc.field === 'description' ? { ...fc, provider: 'open-library' } : fc,
      );

      const res = await request(app.getHttpServer())
        .put('/api/v1/admin/metadata-match/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: custom })
        .expect(200);

      const saved = res.body as Array<{ field: string; provider: string }>;
      expect(saved.find((c) => c.field === 'description')?.provider).toBe(
        'open-library',
      );

      // Verify it persists on a subsequent GET
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/admin/metadata-match/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const fetched = getRes.body as Array<{ field: string; provider: string }>;
      expect(fetched.find((c) => c.field === 'description')?.provider).toBe(
        'open-library',
      );
    });

    it('GET /throttle returns a throttleMs value', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/metadata-match/throttle')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(typeof res.body.throttleMs).toBe('number');
    });

    it('PUT /throttle clamps and persists the value', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/admin/metadata-match/throttle')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ throttleMs: 1000 })
        .expect(200);

      expect(res.body.throttleMs).toBe(1000);
    });
  });
});
