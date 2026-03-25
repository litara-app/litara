import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';
import { seedOzSeries } from './helpers/series.helper';

describe('Series Routes (e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let seriesId: string;
  let book1Id: string;
  let book2Id: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
    const { db, app } = testApp;

    await cleanDatabase(db);
    await createTestUser(db, {
      email: 'series@test.com',
      password: 'password123',
    });
    token = await loginAs(app, 'series@test.com', 'password123');

    const { series, book1, book2 } = await seedOzSeries(db);
    seriesId = series.id;
    book1Id = book1.id;
    book2Id = book2.id;
  });

  afterAll(async () => {
    await cleanDatabase(testApp.db);
    await testApp.app.close();
  });

  describe('GET /api/v1/series', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/series')
        .expect(401);
    });

    it('returns Oz series with correct aggregated data', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/series')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const oz = res.body.find((s: { name: string }) => s.name === 'Oz');
      expect(oz).toBeDefined();
      expect(oz.ownedCount).toBe(2);
      expect(oz.totalBooks).toBe(14);
      expect(oz.coverBookIds.length).toBeGreaterThanOrEqual(1);
      expect(oz.authors).toContain('L. Frank Baum');
    });
  });

  describe('GET /api/v1/series/:id', () => {
    it('returns series detail with books in sequence order', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/series/${seriesId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.name).toBe('Oz');
      expect(res.body.totalBooks).toBe(14);
      expect(res.body.authors).toContain('L. Frank Baum');

      const books = res.body.books as Array<{ id: string; sequence: number }>;
      expect(books.length).toBe(2);
      expect(books[0].id).toBe(book1Id);
      expect(books[0].sequence).toBe(1);
      expect(books[1].id).toBe(book2Id);
      expect(books[1].sequence).toBe(12);
    });

    it('returns 404 for unknown series id', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/series/nonexistent-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
