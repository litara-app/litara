import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Libraries Routes (e2e)', () => {
  let testApp: TestApp;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    const user = await createTestUser(testApp.db);
    userId = user.id;
    token = await loginAs(testApp.app, 'test@test.com', 'password123');
  });

  describe('GET /api/v1/libraries', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .expect(401);
    });

    it('returns empty array when no libraries exist', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns all libraries for the user', async () => {
      await testApp.db.library.create({ data: { name: 'Sci-Fi', userId } });
      await testApp.db.library.create({ data: { name: 'Fantasy', userId } });

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const names = (res.body as Array<{ name: string }>).map((l) => l.name);
      expect(names).toContain('Sci-Fi');
      expect(names).toContain('Fantasy');
    });

    it("does not return another user's libraries", async () => {
      const other = await createTestUser(testApp.db, {
        email: 'other@test.com',
        password: 'pass',
      });
      await testApp.db.library.create({
        data: { name: 'Other Library', userId: other.id },
      });

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const names = (res.body as Array<{ name: string }>).map((l) => l.name);
      expect(names).not.toContain('Other Library');
    });
  });

  describe('POST /api/v1/libraries', () => {
    it('creates a new library and returns it', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sci-Fi Collection' })
        .expect(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Sci-Fi Collection');
    });

    it('the new library appears in GET /libraries', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Fantasy' })
        .expect(201);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const names = (res.body as Array<{ name: string }>).map((l) => l.name);
      expect(names).toContain('Fantasy');
    });

    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .send({ name: 'Unauthorized' })
        .expect(401);
    });
  });

  describe('GET /api/v1/libraries/:id', () => {
    it('returns the library by id', async () => {
      const lib = await testApp.db.library.create({
        data: { name: 'Classics', userId },
      });

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: lib.id, name: 'Classics' });
    });

    it('returns 404 for an unknown id', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it("returns 404 for another user's library", async () => {
      const other = await createTestUser(testApp.db, {
        email: 'other@test.com',
        password: 'pass',
      });
      const lib = await testApp.db.library.create({
        data: { name: 'Private', userId: other.id },
      });

      await request(testApp.app.getHttpServer())
        .get(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/libraries/:id', () => {
    it('renames the library', async () => {
      const lib = await testApp.db.library.create({
        data: { name: 'Old Name', userId },
      });

      const res = await request(testApp.app.getHttpServer())
        .patch(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name' })
        .expect(200);
      expect(res.body).toMatchObject({ id: lib.id, name: 'New Name' });
    });

    it('returns 404 for an unknown id', async () => {
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/libraries/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Whatever' })
        .expect(404);
    });

    it("returns 404 when patching another user's library", async () => {
      const other = await createTestUser(testApp.db, {
        email: 'other@test.com',
        password: 'pass',
      });
      const lib = await testApp.db.library.create({
        data: { name: 'Theirs', userId: other.id },
      });

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Mine Now' })
        .expect(404);
    });
  });
});
