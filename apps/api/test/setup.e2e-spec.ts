import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Setup Routes (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
  });

  describe('GET /api/v1/setup/status', () => {
    it('returns setupRequired: true when no users exist', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/setup/status')
        .expect(200);
      expect(res.body).toEqual({ setupRequired: true });
    });

    it('returns setupRequired: false when a user exists', async () => {
      await createTestUser(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/setup/status')
        .expect(200);
      expect(res.body).toEqual({ setupRequired: false });
    });
  });

  describe('POST /api/v1/setup', () => {
    it('creates the first admin user and returns an access token', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/setup')
        .send({
          email: 'admin@example.com',
          password: 'securepass',
          name: 'Admin',
        })
        .expect(201);

      expect(res.body).toHaveProperty('access_token');
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.user).toMatchObject({
        email: 'admin@example.com',
        name: 'Admin',
        role: 'ADMIN',
      });
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('the created admin can log in with their credentials', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/setup')
        .send({ email: 'admin@example.com', password: 'securepass' })
        .expect(201);

      const loginRes = await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'securepass' })
        .expect(201);
      expect(loginRes.body).toHaveProperty('access_token');
    });

    it('returns 403 when setup has already been completed', async () => {
      await createTestUser(testApp.db);

      await request(testApp.app.getHttpServer())
        .post('/api/v1/setup')
        .send({ email: 'second@example.com', password: 'pass' })
        .expect(403);
    });

    it('returns 400 for an invalid email address', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/setup')
        .send({ email: 'not-an-email', password: 'pass' })
        .expect(400);
    });
  });
});
