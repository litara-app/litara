import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Libraries Routes (e2e)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let userToken: string;
  let tmpDir: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litara-test-'));
  });

  afterAll(async () => {
    await testApp.app.close();
    try {
      fs.rmdirSync(tmpDir, { recursive: true } as unknown as fs.RmDirOptions);
    } catch {
      // tmpdir cleanup is best-effort
    }
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    // Admin user
    const admin = await createTestUser(testApp.db, {
      email: 'admin@test.com',
      password: 'password123',
      role: 'ADMIN',
    });
    adminToken = await loginAs(testApp.app, 'admin@test.com', 'password123');
    // Regular user
    await createTestUser(testApp.db, {
      email: 'user@test.com',
      password: 'password123',
    });
    userToken = await loginAs(testApp.app, 'user@test.com', 'password123');
    void admin; // used indirectly through adminToken
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
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('returns all libraries (global, not user-scoped)', async () => {
      const libPath = path.join(tmpDir, 'lib1');
      fs.mkdirSync(libPath, { recursive: true });
      await testApp.db.library.create({
        data: { name: 'Sci-Fi', path: libPath },
      });

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      const names = (res.body as Array<{ name: string }>).map((l) => l.name);
      expect(names).toContain('Sci-Fi');
    });
  });

  describe('POST /api/v1/libraries', () => {
    it('returns 401 without a JWT', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .send({ name: 'Unauthorized', path: tmpDir })
        .expect(401);
    });

    it('returns 403 for non-admin user', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/libraries')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Non-admin Attempt', path: tmpDir })
        .expect(403);
    });
  });

  describe('GET /api/v1/libraries/:id', () => {
    it('returns the library by id', async () => {
      const libPath = path.join(tmpDir, 'lib2');
      fs.mkdirSync(libPath, { recursive: true });
      const lib = await testApp.db.library.create({
        data: { name: 'Classics', path: libPath },
      });

      const res = await request(testApp.app.getHttpServer())
        .get(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: lib.id, name: 'Classics' });
    });

    it('returns 404 for an unknown id', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/libraries/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/libraries/:id', () => {
    it('returns 403 for non-admin user', async () => {
      const libPath = path.join(tmpDir, 'lib3');
      fs.mkdirSync(libPath, { recursive: true });
      const lib = await testApp.db.library.create({
        data: { name: 'Old Name', path: libPath },
      });

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'New Name' })
        .expect(403);
    });

    it('admin can rename the library', async () => {
      const libPath = path.join(tmpDir, 'lib4');
      fs.mkdirSync(libPath, { recursive: true });
      const lib = await testApp.db.library.create({
        data: { name: 'Old Name', path: libPath },
      });

      const res = await request(testApp.app.getHttpServer())
        .patch(`/api/v1/libraries/${lib.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Name' })
        .expect(200);
      expect(res.body).toMatchObject({ id: lib.id, name: 'New Name' });
    });

    it('returns 404 for an unknown id (admin)', async () => {
      await request(testApp.app.getHttpServer())
        .patch('/api/v1/libraries/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Whatever' })
        .expect(404);
    });
  });
});
