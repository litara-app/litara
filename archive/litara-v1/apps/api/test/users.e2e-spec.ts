import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Users Routes (e2e)', () => {
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

  describe('GET /api/v1/users/me/settings', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/settings')
        .expect(401);
    });

    it('returns default settings for a new user', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('dashboardLayout');
      expect(res.body).toHaveProperty('bookItemSize', 'md');
      expect(Array.isArray(res.body.dashboardLayout)).toBe(true);
      expect(res.body.dashboardLayout).toHaveLength(2);

      const keys = (res.body.dashboardLayout as Array<{ key: string }>).map(
        (s) => s.key,
      );
      expect(keys).toContain('currently-reading');
      expect(keys).toContain('recently-added');
    });
  });

  describe('PATCH /api/v1/users/me/settings', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/users/me/settings')
        .send({ bookItemSize: 'lg' })
        .expect(401);
    });

    it('updates bookItemSize', async () => {
      const res = await request(testApp.app.getHttpServer())
        .patch('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookItemSize: 'lg' })
        .expect(200);

      expect(res.body).toHaveProperty('bookItemSize', 'lg');
    });

    it('persists bookItemSize across subsequent GET', async () => {
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookItemSize: 'sm' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('bookItemSize', 'sm');
    });

    it('updates dashboardLayout', async () => {
      const layout = [
        {
          key: 'recently-added',
          label: 'Recently Added',
          visible: true,
          order: 0,
        },
        {
          key: 'currently-reading',
          label: 'Currently Reading',
          visible: false,
          order: 1,
        },
      ];

      const res = await request(testApp.app.getHttpServer())
        .patch('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ dashboardLayout: layout })
        .expect(200);

      expect(res.body.dashboardLayout).toHaveLength(2);
      const recentlyAdded = (res.body.dashboardLayout as typeof layout).find(
        (s) => s.key === 'recently-added',
      );
      expect(recentlyAdded).toMatchObject({ visible: true, order: 0 });
    });

    it('settings are isolated per user', async () => {
      // Update first user's settings
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookItemSize: 'xl' })
        .expect(200);

      // Second user gets default settings
      await createTestUser(testApp.db, {
        email: 'other@test.com',
        password: 'pass456',
      });
      const otherToken = await loginAs(
        testApp.app,
        'other@test.com',
        'pass456',
      );

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/settings')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('bookItemSize', 'md');
    });
  });
});
