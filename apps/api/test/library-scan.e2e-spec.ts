import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Library Scan Routes (e2e)', () => {
  let testApp: TestApp;
  let token: string;

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
  });

  describe('POST /api/v1/library/scan', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/library/scan')
        .expect(401);
    });

    it('returns 200 with a scan started message', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/library/scan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body).toHaveProperty('message', 'Scan started');
    });

    it('accepts enrichMetadata=true query parameter', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/library/scan?enrichMetadata=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body).toHaveProperty('message', 'Scan started');
    });

    it('accepts rescanMetadata=true query parameter', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/library/scan?rescanMetadata=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body).toHaveProperty('message', 'Scan started');
    });
  });
});
