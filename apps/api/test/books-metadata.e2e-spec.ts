import path from 'path';
import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

const EBOOK_DIR = process.env.EBOOK_LIBRARY_PATH!;
const PRIDE_EPUB = path.join(
  EBOOK_DIR,
  'Pride and Prejudice - Jane Austen.epub',
);
const GATSBY_EPUB = path.join(
  EBOOK_DIR,
  'The Great Gatsby - F Scott Fitzgerald.epub',
);
const GATSBY_MOBI = path.join(
  EBOOK_DIR,
  'The Great Gatsby - F Scott Fitzgerald.mobi',
);

async function seedRealBook(
  db: TestApp['db'],
  opts: {
    title: string;
    filePath: string;
    format: string;
    fileHash: string;
    coverData?: Buffer;
  },
) {
  const library =
    (await db.library.findFirst()) ??
    (await db.library.create({ data: { name: 'Test Library' } }));
  return db.book.create({
    data: {
      libraryId: library.id,
      title: opts.title,
      coverData: opts.coverData as unknown as Uint8Array<ArrayBuffer>,
      files: {
        create: [
          {
            filePath: opts.filePath,
            format: opts.format,
            sizeBytes: BigInt(1024),
            fileHash: opts.fileHash,
          },
        ],
      },
    },
    include: { files: true },
  });
}

describe('Books Metadata Updates (e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let bookId: string;
  let fileId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await createTestUser(testApp.db);
    token = await loginAs(testApp.app, 'test@test.com', 'password123');

    const book = await seedRealBook(testApp.db, {
      title: 'Pride and Prejudice',
      filePath: PRIDE_EPUB,
      format: 'EPUB',
      fileHash: 'a'.repeat(64),
      coverData: Buffer.from('fake-cover'),
    });
    bookId = book.id;
    fileId = book.files[0].id;
  });

  describe('PATCH /api/v1/books/:id — library assignment', () => {
    it('assigns a valid library to the book', async () => {
      // Libraries are user-scoped; create one for the test user
      const libraryRes = await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Personal Collection' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ libraryId: libraryRes.body.id })
        .expect(200);
    });

    it('returns 400 when libraryId is not owned by the user', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ libraryId: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/books/:id — scalar metadata fields', () => {
    it('updates title', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.title).toBe('Updated Title');
    });

    it('updates subtitle', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subtitle: 'A Novel of Manners' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.subtitle).toBe('A Novel of Manners');
    });

    it('updates publisher and language', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ publisher: 'T. Egerton', language: 'en' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.publisher).toBe('T. Egerton');
      expect(res.body.language).toBe('en');
    });

    it('clears publishedDate when sent as empty string', async () => {
      // First set a date
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ publishedDate: '1813-01-01' })
        .expect(200);

      // Then clear it
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ publishedDate: '' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.publishedDate).toBeNull();
    });

    it('updates goodreadsRating', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ goodreadsRating: 4.3 })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.goodreadsRating).toBe(4.3);
    });

    it('logs a warning and continues when coverUrl fetch fails', async () => {
      // A bad URL — no real server, so fetch will throw or return a non-OK response
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          coverUrl: 'http://localhost:1/nonexistent.jpg',
          title: 'Cover Fail Test',
        })
        .expect(200);

      // Book update should still have applied the title
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.title).toBe('Cover Fail Test');
    });

    it('updates pageCount', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pageCount: 432 })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.pageCount).toBe(432);
    });
  });

  describe('PATCH /api/v1/books/:id — relational metadata fields', () => {
    it('replaces authors', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ authors: ['Jane Austen', 'Charlotte Brontë'] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.authors).toHaveLength(2);
      expect(res.body.authors).toContain('Jane Austen');
      expect(res.body.authors).toContain('Charlotte Brontë');
    });

    it('replaces tags', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tags: ['Classic', 'Romance'] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.tags).toContain('Classic');
      expect(res.body.tags).toContain('Romance');
    });

    it('replaces genres', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ genres: ['Literary Fiction'] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.genres).toContain('Literary Fiction');
    });

    it('replaces moods', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moods: ['Witty', 'Romantic'] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.moods).toContain('Witty');
      expect(res.body.moods).toContain('Romantic');
    });
  });

  describe('PATCH /api/v1/books/:id — series', () => {
    it('assigns a series with sequence and totalBooks', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          seriesName: 'Austen Classics',
          seriesPosition: 2,
          seriesTotalBooks: 6,
        })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.series).toMatchObject({
        name: 'Austen Classics',
        sequence: 2,
        totalBooks: 6,
      });
    });

    it('removes series when seriesName is null', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ seriesName: 'Austen Classics', seriesPosition: 1 })
        .expect(200);

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ seriesName: null })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.series).toBeNull();
    });
  });

  describe('PATCH /api/v1/books/:id — lockedFields', () => {
    it('persists lockedFields on the book', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lockedFields: ['title', 'authors'] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.lockedFields).toContain('title');
      expect(res.body.lockedFields).toContain('authors');
    });
  });

  describe('GET /api/v1/books/:id/file-metadata', () => {
    it('reads real EPUB metadata from disk', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/file-metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('title');
      expect(res.body).toHaveProperty('authors');
      expect(Array.isArray(res.body.authors)).toBe(true);
      // Pride and Prejudice EPUB should report Jane Austen
      expect(
        (res.body.authors as string[]).some((a) =>
          a.toLowerCase().includes('austen'),
        ),
      ).toBe(true);
    });
  });

  describe('GET /api/v1/books/:id/files/:fileId/download', () => {
    it('streams the real EPUB file as an attachment', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/files/${fileId}/download`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
      expect(res.body).toBeDefined();
    });
  });

  describe('GET /api/v1/books/:id/sidecar/export', () => {
    it('returns a JSON attachment with book metadata', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          authors: ['Jane Austen'],
          isbn13: '9780141439518',
          tags: ['Fiction'],
          genres: ['Literary Fiction'],
          moods: ['Witty'],
        })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/sidecar/export`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.body).toHaveProperty('title', 'Pride and Prejudice');
      expect(res.body).toHaveProperty('authors');
      expect(res.body).toHaveProperty('isbn13', '9780141439518');
      expect(res.body.categories).toContain('Fiction');
      expect(res.body.genres).toContain('Literary Fiction');
      expect(res.body.moods).toContain('Witty');
    });
  });

  describe('POST /api/v1/books/:id/match', () => {
    it('merges source book files into target and deletes source', async () => {
      const source = await seedRealBook(testApp.db, {
        title: 'The Great Gatsby',
        filePath: GATSBY_EPUB,
        format: 'EPUB',
        fileHash: 'b'.repeat(64),
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${bookId}/match`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mergeFromId: source.id })
        .expect(201);

      // Source book should be gone
      await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${source.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Target should now have both files
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.files).toHaveLength(2);
    });

    it('returns 400 when source and target are the same book', async () => {
      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${bookId}/match`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mergeFromId: bookId })
        .expect(400);
    });

    it('returns 404 when target book does not exist', async () => {
      const source = await seedRealBook(testApp.db, {
        title: 'The Great Gatsby',
        filePath: GATSBY_MOBI,
        format: 'MOBI',
        fileHash: 'c'.repeat(64),
      });

      await request(testApp.app.getHttpServer())
        .post('/api/v1/books/00000000-0000-0000-0000-000000000000/match')
        .set('Authorization', `Bearer ${token}`)
        .send({ mergeFromId: source.id })
        .expect(404);
    });
  });

  describe('GET /api/v1/books/:id/sidecar', () => {
    it('returns empty body when no sidecar file is linked', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/sidecar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // NestJS serialises a null return as an empty body; supertest parses that as {}
      expect(res.body).toEqual({});
    });

    it('returns parsed JSON after a sidecar has been scanned', async () => {
      // Scan first — Pride epub has a matching metadata.json in the same dir
      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${bookId}/sidecar/scan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/sidecar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveProperty('title', 'Pride and Prejudice');
      expect(res.body).toHaveProperty('authors');
    });
  });

  describe('POST /api/v1/books/:id/sidecar/scan', () => {
    it('returns null when no sidecar file exists alongside the book', async () => {
      // Gatsby MOBI has no matching metadata.json
      const book = await seedRealBook(testApp.db, {
        title: 'The Great Gatsby',
        filePath: GATSBY_MOBI,
        format: 'MOBI',
        fileHash: 'c'.repeat(64),
      });

      const res = await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/sidecar/scan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body).toEqual({ sidecarFile: null });
    });

    it('returns the sidecar path when a metadata.json exists', async () => {
      // Pride and Prejudice has a matching Pride and Prejudice.metadata.json
      const res = await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${bookId}/sidecar/scan`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body.sidecarFile).toBeTruthy();
      expect(res.body.sidecarFile).toMatch(
        /Pride and Prejudice\.metadata\.json$/,
      );
    });

    it('returns 404 for an unknown book', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/books/00000000-0000-0000-0000-000000000000/sidecar/scan')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/books/:id/file-metadata — error paths', () => {
    it('returns 400 for an unsupported file format (CBZ)', async () => {
      const book = await seedRealBook(testApp.db, {
        title: 'A Comic',
        filePath: '/fake/comic.cbz',
        format: 'CBZ',
        fileHash: 'd'.repeat(64),
      });

      await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book.id}/file-metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 when the book has no accessible file', async () => {
      const library = await testApp.db.library.findFirst()!;
      const emptyBook = await testApp.db.book.create({
        data: { libraryId: library!.id, title: 'No Files' },
      });

      await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${emptyBook.id}/file-metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/books/:id/search-metadata — error paths', () => {
    it('returns 404 for an unknown book', async () => {
      await request(testApp.app.getHttpServer())
        .get(
          '/api/v1/books/00000000-0000-0000-0000-000000000000/search-metadata?provider=open-library',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/books/:id/apply-metadata — error paths', () => {
    it('returns 404 for an unknown book', async () => {
      await request(testApp.app.getHttpServer())
        .post(
          '/api/v1/books/00000000-0000-0000-0000-000000000000/apply-metadata',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/books/:id/shelves — error paths', () => {
    it('returns 400 when a shelf does not belong to the user', async () => {
      const otherUser = await testApp.db.user.create({
        data: { email: 'other@test.com', password: 'hash', role: 'USER' },
      });
      const otherShelf = await testApp.db.shelf.create({
        data: { name: 'Not Mine', userId: otherUser.id },
      });

      await request(testApp.app.getHttpServer())
        .put(`/api/v1/books/${bookId}/shelves`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shelfIds: [otherShelf.id] })
        .expect(400);
    });
  });

  describe('GET /api/v1/books/:id/files/:fileId/download — error paths', () => {
    it('returns 404 for an unknown file', async () => {
      await request(testApp.app.getHttpServer())
        .get(
          `/api/v1/books/${bookId}/files/00000000-0000-0000-0000-000000000000/download`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 410 Gone when the file is marked as missing', async () => {
      await testApp.db.bookFile.update({
        where: { id: fileId },
        data: { missingAt: new Date() },
      });

      await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}/files/${fileId}/download`)
        .set('Authorization', `Bearer ${token}`)
        .expect(410);
    });
  });

  describe('GET /api/v1/books/:id — shelves in response', () => {
    it('includes shelves when the book is assigned to one', async () => {
      const user = await testApp.db.user.findUnique({
        where: { email: 'test@test.com' },
      });
      const shelf = await testApp.db.shelf.create({
        data: { name: 'Test Shelf', userId: user!.id },
      });
      await request(testApp.app.getHttpServer())
        .put(`/api/v1/books/${bookId}/shelves`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shelfIds: [shelf.id] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${bookId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.shelves).toHaveLength(1);
      expect(res.body.shelves[0]).toMatchObject({
        id: shelf.id,
        name: 'Test Shelf',
      });
    });
  });
});
