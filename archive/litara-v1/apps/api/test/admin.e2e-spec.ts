import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

async function createAdminUser(db: TestApp['db'], email = 'admin@test.com') {
  return createTestUser(db, { email, password: 'adminpass', role: 'ADMIN' });
}

describe('Admin Routes (e2e)', () => {
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

  describe('GET /api/v1/admin/users', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/users')
        .expect(401);
    });

    it('returns 403 for a non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns all users for an admin', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('returns correct shape: id, email, name, role, createdAt', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const user = (res.body as Array<Record<string, unknown>>).find(
        (u) => u.email === 'admin@test.com',
      );
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email', 'admin@test.com');
      expect(user).toHaveProperty('role', 'ADMIN');
      expect(user).toHaveProperty('createdAt');
      expect(user).not.toHaveProperty('password');
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('creates a new user and returns it without a password', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'new@test.com', password: 'pass123', name: 'New User' })
        .expect(201);

      expect(res.body).toMatchObject({
        email: 'new@test.com',
        name: 'New User',
        role: 'USER',
      });
      expect(res.body).not.toHaveProperty('password');
    });

    it('creates a user with ADMIN role when specified', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'newadmin@test.com',
          password: 'pass123',
          role: 'ADMIN',
        })
        .expect(201);

      expect(res.body).toHaveProperty('role', 'ADMIN');
    });

    it('returns 409 when email is already in use', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'test@test.com', password: 'pass123' })
        .expect(409);
    });

    it('returns 400 for an invalid email address', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'not-an-email', password: 'pass123' })
        .expect(400);
    });

    it('returns 403 for a non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'sneaky@test.com', password: 'pass123' })
        .expect(403);
    });
  });

  describe('PATCH /api/v1/admin/users/:id', () => {
    it('updates the user name', async () => {
      const target = await testApp.db.user.findUnique({
        where: { email: 'test@test.com' },
      });

      const res = await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/users/${target!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body).toHaveProperty('name', 'Updated Name');
    });

    it('promotes a user to ADMIN', async () => {
      const target = await testApp.db.user.findUnique({
        where: { email: 'test@test.com' },
      });

      const res = await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/users/${target!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(res.body).toHaveProperty('role', 'ADMIN');
    });

    it('returns 400 when admin tries to demote themselves', async () => {
      const admin = await testApp.db.user.findUnique({
        where: { email: 'admin@test.com' },
      });

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/admin/users/${admin!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'USER' })
        .expect(400);
    });

    it('returns 404 for an unknown user id', async () => {
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ghost' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/admin/users/:id', () => {
    it('deletes a user and returns 204', async () => {
      const target = await testApp.db.user.findUnique({
        where: { email: 'test@test.com' },
      });

      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/admin/users/${target!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const deleted = await testApp.db.user.findUnique({
        where: { id: target!.id },
      });
      expect(deleted).toBeNull();
    });

    it('returns 400 when admin tries to delete themselves', async () => {
      const admin = await testApp.db.user.findUnique({
        where: { email: 'admin@test.com' },
      });

      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/admin/users/${admin!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns 404 for an unknown user id', async () => {
      await request(testApp.app.getHttpServer())
        .delete('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 403 for a non-admin user', async () => {
      const target = await testApp.db.user.findUnique({
        where: { email: 'admin@test.com' },
      });

      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/admin/users/${target!.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });
});
