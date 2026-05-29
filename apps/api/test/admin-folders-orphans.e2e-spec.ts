import { randomUUID } from 'crypto';
import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

async function createAdminUser(db: TestApp['db'], email = 'admin@test.com') {
  return createTestUser(db, { email, password: 'adminpass', role: 'ADMIN' });
}

/** Seed a library with a unique (required, unique) path. */
async function createLibrary(db: TestApp['db'], name = 'Test Library') {
  return db.library.create({
    data: { name, path: `/test/library-${randomUUID()}` },
  });
}

/**
 * Seed an orphan book with no file on disk. The reassign endpoint takes a
 * deterministic DB-only branch when a book has no file, so these stay hermetic.
 */
async function createOrphanBook(db: TestApp['db'], title: string) {
  return db.book.create({
    data: { title, libraryId: null, isOrphan: true },
  });
}

describe('Admin Folders & Orphans Routes (e2e)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await createAdminUser(testApp.db);
    await createTestUser(testApp.db); // regular user
    adminToken = await loginAs(testApp.app, 'admin@test.com', 'adminpass');
    userToken = await loginAs(testApp.app, 'test@test.com', 'password123');
  });

  describe('GET /api/v1/admin/folders', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .expect(401);
    });

    it('returns 403 for a non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('lists directories under the library root for an admin', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const entries = res.body as Array<{
        name: string;
        relPath: string;
        hasChildren: boolean;
      }>;
      // The fixture root contains an "Alastair Reynolds" subdirectory which
      // itself contains "Revelation Space".
      const reynolds = entries.find((e) => e.name === 'Alastair Reynolds');
      expect(reynolds).toBeDefined();
      expect(reynolds).toMatchObject({
        relPath: 'Alastair Reynolds',
        hasChildren: true,
      });
    });

    it('lists nested directories via the path query parameter', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .query({ path: 'Alastair Reynolds' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const entries = res.body as Array<{ name: string }>;
      expect(entries.some((e) => e.name === 'Revelation Space')).toBe(true);
    });

    it('returns 400 for a path that escapes the library root', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .query({ path: '../../' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns 404 for a non-existent path', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/folders')
        .query({ path: 'does-not-exist' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/admin/books/orphan-stats', () => {
    it('returns 403 for a non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/books/orphan-stats')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns orphaned book count and library count', async () => {
      await createLibrary(testApp.db);
      await createOrphanBook(testApp.db, 'Orphan One');
      await createOrphanBook(testApp.db, 'Orphan Two');

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/books/orphan-stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toEqual({ orphanedBookCount: 2, libraryCount: 1 });
    });
  });

  describe('GET /api/v1/admin/books/orphans', () => {
    it('returns 403 for a non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/books/orphans')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns a paginated list of orphan books', async () => {
      await createOrphanBook(testApp.db, 'Orphan One');
      await createOrphanBook(testApp.db, 'Orphan Two');

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/books/orphans')
        .query({ skip: 0, take: 50 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ total: 2, skip: 0, take: 50 });
      expect(Array.isArray(res.body.books)).toBe(true);
      expect(res.body.books).toHaveLength(2);
    });
  });

  describe('PATCH /api/v1/admin/books/:id/reassign-library', () => {
    it('returns 403 for a non-admin user', async () => {
      const book = await createOrphanBook(testApp.db, 'Orphan');
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/books/${book.id}/reassign-library`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ libraryId: 'whatever' })
        .expect(403);
    });

    it('returns 404 for an unknown book id', async () => {
      const library = await createLibrary(testApp.db);
      await request(testApp.app.getHttpServer())
        .patch(
          '/api/v1/admin/books/00000000-0000-0000-0000-000000000000/reassign-library',
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ libraryId: library.id })
        .expect(404);
    });

    it('returns 404 for an unknown library id', async () => {
      const book = await createOrphanBook(testApp.db, 'Orphan');
      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/books/${book.id}/reassign-library`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ libraryId: '00000000-0000-0000-0000-000000000000' })
        .expect(404);
    });

    it('reassigns a fileless orphan book and clears the orphan flag', async () => {
      const library = await createLibrary(testApp.db);
      const book = await createOrphanBook(testApp.db, 'Orphan');

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/books/${book.id}/reassign-library`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ libraryId: library.id })
        .expect(200);

      const updated = await testApp.db.book.findUnique({
        where: { id: book.id },
      });
      expect(updated).toMatchObject({ libraryId: library.id, isOrphan: false });
    });
  });
});
