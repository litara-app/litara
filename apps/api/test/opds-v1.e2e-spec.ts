import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createOpdsUser } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

async function enableOpds(db: any) {
  await db.serverSettings.upsert({
    where: { key: 'opds_enabled' },
    create: { key: 'opds_enabled', value: 'true' },
    update: { value: 'true' },
  });
}

async function seedData(db: any) {
  const library = await db.library.create({ data: { name: 'Test Library' } });

  const author = await db.author.create({ data: { name: 'Jane Doe' } });
  const genre = await db.genre.create({ data: { name: 'Fiction' } });
  const series = await db.series.create({ data: { name: 'Test Series' } });

  const book = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'Test Book',
      description: 'A test book',
      language: 'en',
      publisher: 'Test Publisher',
      coverData: Buffer.from('fake-cover'),
      authors: { create: [{ authorId: author.id }] },
      genres: { connect: [{ id: genre.id }] },
      series: { create: [{ seriesId: series.id, sequence: 1 }] },
      files: {
        create: [
          {
            filePath: '/fake/test.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024 * 1024),
            fileHash: 'a'.repeat(64),
          },
          {
            filePath: '/fake/test.pdf',
            format: 'PDF',
            sizeBytes: BigInt(2048 * 1024),
            fileHash: 'b'.repeat(64),
          },
        ],
      },
    },
    include: { files: true },
  });

  return { library, author, genre, series, book };
}

describe('OPDS v1 (e2e)', () => {
  let testApp: TestApp;
  const USERNAME = 'opds-user';
  const PASSWORD = 'opds-secret';

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await createOpdsUser(testApp.db, {
      username: USERNAME,
      password: PASSWORD,
    });
    await enableOpds(testApp.db);
  });

  describe('GET /opds/v1 (root feed)', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer()).get('/opds/v1').expect(401);
    });

    it('returns 200 with Basic Auth', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/atom\+xml/);
      expect(res.text).toContain('<feed');
      expect(res.text).toContain('Litara Library');
      expect(res.text).toContain('All Books');
      expect(res.text).toContain('New Arrivals');
    });

    it('returns 401 with wrong password', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1')
        .auth(USERNAME, 'wrong-password')
        .expect(401);
    });
  });

  describe('GET /opds/v1/search (OpenSearch description)', () => {
    it('returns 200 without auth', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/search')
        .expect(200);

      expect(res.headers['content-type']).toMatch(/opensearchdescription\+xml/);
      expect(res.text).toContain('OpenSearchDescription');
      expect(res.text).toContain('Litara');
    });
  });

  describe('GET /opds/v1/catalog', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog')
        .expect(401);
    });

    it('returns 200 with correct content type', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/atom\+xml/);
    });

    it('lists books with acquisition links', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Book');
      expect(res.text).toContain('urn:litara:book:');
      expect(res.text).toContain('http://opds-spec.org/acquisition');
      expect(res.text).toContain('application/epub+zip');
      expect(res.text).toContain('application/pdf');
    });

    it('includes cover links when book has cover', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('http://opds-spec.org/image');
      expect(res.text).toContain('/api/v1/books/');
      expect(res.text).toContain('/cover');
    });

    it('includes pagination links when there are many books', async () => {
      const library = await testApp.db.library.create({
        data: { name: 'Big Library' },
      });
      // Create 25 books to exceed page size of 20
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          testApp.db.book.create({
            data: {
              libraryId: library.id,
              title: `Book ${i + 1}`,
              files: {
                create: [
                  {
                    filePath: `/fake/book${i + 1}.epub`,
                    format: 'EPUB',
                    sizeBytes: BigInt(1024),
                    fileHash: `${'c'.repeat(63)}${i.toString(16)}`,
                  },
                ],
              },
            },
          }),
        ),
      );

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog?page=1')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('rel="next"');
    });

    it('includes previous link on page 2', async () => {
      const library = await testApp.db.library.create({
        data: { name: 'Big Library 2' },
      });
      await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          testApp.db.book.create({
            data: {
              libraryId: library.id,
              title: `Book ${i + 1}`,
              files: {
                create: [
                  {
                    filePath: `/fake/b2book${i + 1}.epub`,
                    format: 'EPUB',
                    sizeBytes: BigInt(1024),
                    fileHash: `${'d'.repeat(63)}${i.toString(16)}`,
                  },
                ],
              },
            },
          }),
        ),
      );

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/catalog?page=2')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('rel="previous"');
    });
  });

  describe('GET /opds/v1/search/results', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/search/results?q=test')
        .expect(401);
    });

    it('returns matching books', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/search/results?q=Test')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Book');
    });

    it('returns empty feed for no matches', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/search/results?q=nonexistent-xyz')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).not.toContain('<entry>');
    });
  });

  describe('GET /opds/v1/new', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/new')
        .expect(401);
    });

    it('returns books ordered by newest first', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/new')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/atom\+xml/);
      expect(res.text).toContain('New Arrivals');
    });
  });

  describe('GET /opds/v1/authors', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/authors')
        .expect(401);
    });

    it('lists authors', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/authors')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Jane Doe');
    });
  });

  describe('GET /opds/v1/authors/:authorId', () => {
    it('returns books by author', async () => {
      const { author } = await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get(`/opds/v1/authors/${author.id}`)
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Book');
    });
  });

  describe('GET /opds/v1/series', () => {
    it('lists series', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/series')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Series');
    });
  });

  describe('GET /opds/v1/series/:seriesId', () => {
    it('returns books in series', async () => {
      const { series } = await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get(`/opds/v1/series/${series.id}`)
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Book');
    });
  });

  describe('GET /opds/v1/genres', () => {
    it('lists genres', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/genres')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Fiction');
    });
  });

  describe('GET /opds/v1/genres/:genreName', () => {
    it('returns books in genre', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v1/genres/Fiction')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.text).toContain('Test Book');
    });
  });

  describe('GET /opds/v1/download/:bookId/:fileId', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/download/fake-book/fake-file')
        .expect(401);
    });

    it('returns 404 for non-existent file', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v1/download/nonexistent-book/nonexistent-file')
        .auth(USERNAME, PASSWORD)
        .expect(404);
    });
  });
});
