import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

async function seedLibraryAndBooks(db: any) {
  const library = await db.library.create({
    data: { name: 'Default Library' },
  });

  const author1 = await db.author.create({ data: { name: 'Author Alpha' } });
  const author2 = await db.author.create({ data: { name: 'Author Beta' } });

  const book1 = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'Alpha Book',
      coverData: Buffer.from('fake-cover-bytes'),
      files: {
        create: [
          {
            filePath: '/fake/alpha.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024 * 1024),
            fileHash: 'a'.repeat(64),
          },
        ],
      },
      authors: { create: [{ authorId: author1.id }] },
    },
  });

  const book2 = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'Beta Book',
      files: {
        create: [
          {
            filePath: '/fake/beta.mobi',
            format: 'MOBI',
            sizeBytes: BigInt(512 * 1024),
            fileHash: 'b'.repeat(64),
          },
        ],
      },
      authors: { create: [{ authorId: author2.id }] },
    },
  });

  return { library, book1, book2 };
}

describe('Books Routes (e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let book1Id: string;
  let book2Id: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    const { book1, book2 } = await seedLibraryAndBooks(testApp.db);
    book1Id = book1.id;
    book2Id = book2.id;
    await createTestUser(testApp.db);
    token = await loginAs(testApp.app, 'test@test.com', 'password123');
  });

  describe('GET /api/v1/books', () => {
    it('returns 200 with all books for an authenticated user', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/books')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/books')
        .expect(401);
    });

    it('paginates with limit and offset', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/books?limit=1&offset=0')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('searches by title keyword', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/books?q=Alpha')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Alpha Book');
    });

    it('returns correct shape: id, title, authors, hasCover, formats', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/books?q=Alpha')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const book = res.body[0];
      expect(book).toHaveProperty('id');
      expect(book).toHaveProperty('title', 'Alpha Book');
      expect(book).toHaveProperty('authors');
      expect(book.authors).toContain('Author Alpha');
      expect(book).toHaveProperty('hasCover', true);
      expect(book).toHaveProperty('formats');
      expect(book.formats).toContain('EPUB');
    });
  });

  describe('GET /api/v1/books/:id', () => {
    it('returns full book details including authors, files, and userReview', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveProperty('id', book1Id);
      expect(res.body).toHaveProperty('title', 'Alpha Book');
      expect(res.body.authors).toContain('Author Alpha');
      expect(Array.isArray(res.body.files)).toBe(true);
      expect(res.body.files[0]).toHaveProperty('format', 'EPUB');
      expect(res.body).toHaveProperty('userReview');
      expect(res.body.userReview.readStatus).toBe('UNREAD');
    });

    it('returns 404 for an unknown book id', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/books/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/books/:id', () => {
    it('sets readStatus to READING', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${book1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ readStatus: 'READING' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.userReview.readStatus).toBe('READING');
    });

    it('sets a rating value', async () => {
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/books/${book1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 4.5 })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.userReview.rating).toBe(4.5);
    });
  });

  describe('GET /api/v1/books/:id/cover', () => {
    it('returns 200 image/jpeg when coverData exists', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book1Id}/cover`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    });

    it('returns 404 when no cover is stored', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/api/v1/books/${book2Id}/cover`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/books/:id/shelves', () => {
    it('assigns a book to a shelf; GET /shelves/:id/books reflects it', async () => {
      // Seed a shelf for this user
      const shelf = await testApp.db.shelf.create({
        data: {
          name: 'My Shelf',
          user: { connect: { email: 'test@test.com' } },
        },
      });

      await request(testApp.app.getHttpServer())
        .put(`/api/v1/books/${book1Id}/shelves`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shelfIds: [shelf.id] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/shelves/${shelf.id}/books`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(book1Id);
    });

    it('removes a book from a shelf when shelfIds is empty', async () => {
      const shelf = await testApp.db.shelf.create({
        data: {
          name: 'My Shelf',
          user: { connect: { email: 'test@test.com' } },
        },
      });

      // Add first
      await request(testApp.app.getHttpServer())
        .put(`/api/v1/books/${book1Id}/shelves`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shelfIds: [shelf.id] })
        .expect(200);

      // Remove by sending empty array
      await request(testApp.app.getHttpServer())
        .put(`/api/v1/books/${book1Id}/shelves`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shelfIds: [] })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/shelves/${shelf.id}/books`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
