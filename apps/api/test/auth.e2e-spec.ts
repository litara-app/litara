import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Auth (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await createTestUser(testApp.db, {
      email: 'user@test.com',
      password: 'secret123',
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns access_token for valid credentials', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'user@test.com', password: 'secret123' })
        .expect(201);
      expect(res.body).toHaveProperty('access_token');
      expect(typeof res.body.access_token).toBe('string');
    });

    it('returns 401 for wrong password', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'user@test.com', password: 'wrong' })
        .expect(401);
    });

    it('returns 401 for unknown email', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.com', password: 'secret123' })
        .expect(401);
    });
  });

  describe('JWT-protected routes', () => {
    it('returns 401 on GET /api/v1/books without Authorization header', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/books')
        .expect(401);
    });

    it('returns 401 on GET /api/v1/books with a malformed token', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/books')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('returns 200 with a valid JWT', async () => {
      const loginRes = await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'user@test.com', password: 'secret123' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .get('/api/v1/books')
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .expect(200);
    });
  });
});
