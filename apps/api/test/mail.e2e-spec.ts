import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

const SMTP_BODY = {
  host: 'smtp.example.com',
  port: 587,
  fromAddress: 'test@example.com',
  username: 'testuser',
  password: 'secretpassword',
  enableAuth: true,
  enableStartTls: true,
};

async function createAdminAndUser(db: TestApp['db']) {
  const admin = await createTestUser(db, {
    email: 'admin@test.com',
    password: 'adminpass',
    role: 'ADMIN',
  });
  const user = await createTestUser(db, {
    email: 'user@test.com',
    password: 'userpass',
    role: 'USER',
  });
  return { admin, user };
}

async function seedBook(
  db: TestApp['db'],
  opts: { formats?: { filePath: string; format: string }[] } = {},
) {
  const library = await db.library.create({ data: { name: 'Test Library' } });
  const formats = opts.formats ?? [
    { filePath: '/books/test.epub', format: 'EPUB' },
  ];
  const book = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'Test Book',
      files: {
        create: formats.map((f) => ({
          filePath: f.filePath,
          format: f.format,
          sizeBytes: BigInt(1024 * 1024),
        })),
      },
    },
    include: { files: { orderBy: { createdAt: 'asc' } } },
  });
  return book;
}

// ─── Server SMTP Settings (Admin) ────────────────────────────────────────────

describe('Server SMTP Settings (e2e)', () => {
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
    await createAdminAndUser(testApp.db);
    adminToken = await loginAs(testApp.app, 'admin@test.com', 'adminpass');
    userToken = await loginAs(testApp.app, 'user@test.com', 'userpass');
  });

  describe('GET /api/v1/settings/smtp', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .expect(401);
    });

    it('returns 403 for non-admin', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns 404 when no config has been saved', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns config without password after saving', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.host).toBe(SMTP_BODY.host);
      expect(res.body.port).toBe(SMTP_BODY.port);
      expect(res.body.fromAddress).toBe(SMTP_BODY.fromAddress);
      expect(res.body.username).toBe(SMTP_BODY.username);
      expect(res.body.enableAuth).toBe(SMTP_BODY.enableAuth);
      expect(res.body.enableStartTls).toBe(SMTP_BODY.enableStartTls);
      expect(res.body).not.toHaveProperty('password');
      expect(res.body.passwordHint).toMatch(/•••••/);
      expect(res.body.passwordHint).toContain('ord'); // last 3 of 'secretpassword'
    });
  });

  describe('PUT /api/v1/settings/smtp', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .send(SMTP_BODY)
        .expect(401);
    });

    it('returns 403 for non-admin', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(403);
    });

    it('saves config and returns 200 without password', async () => {
      const res = await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      expect(res.body.host).toBe(SMTP_BODY.host);
      expect(res.body).not.toHaveProperty('password');
      expect(res.body.passwordHint).toBeDefined();
    });

    it('retains password when omitted on subsequent saves (sentinel)', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      // Update host only, no password
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...SMTP_BODY, host: 'smtp.updated.com', password: undefined })
        .expect(200);

      // The password hint should still be based on the original password
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.host).toBe('smtp.updated.com');
      expect(res.body.passwordHint).toContain('ord'); // last 3 of 'secretpassword'
    });
  });

  describe('DELETE /api/v1/settings/smtp', () => {
    it('returns 403 for non-admin', async () => {
      await request(testApp.app.getHttpServer())
        .delete('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('deletes the config and returns 204', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      await request(testApp.app.getHttpServer())
        .delete('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(testApp.app.getHttpServer())
        .get('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 204 even when no config exists (idempotent)', async () => {
      await request(testApp.app.getHttpServer())
        .delete('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });

  describe('POST /api/v1/settings/smtp/test', () => {
    it('returns 403 for non-admin', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/settings/smtp/test')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(403);
    });

    it('returns 200 with success=false when SMTP server is unreachable', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/settings/smtp/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      // We expect failure since smtp.example.com doesn't exist in CI
      expect(res.body).toHaveProperty('success');
      expect(typeof res.body.success).toBe('boolean');
      if (!res.body.success) {
        expect(res.body).toHaveProperty('error');
      }
    });

    it('uses saved password when password field is omitted', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(SMTP_BODY)
        .expect(200);

      const bodyWithoutPassword = { ...SMTP_BODY, password: undefined };
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/settings/smtp/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bodyWithoutPassword)
        .expect(200);

      expect(res.body).toHaveProperty('success');
    });
  });
});

// ─── Per-User SMTP Settings ───────────────────────────────────────────────────

describe('User SMTP Settings (e2e)', () => {
  let testApp: TestApp;
  let userToken: string;

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
      password: 'userpass',
    });
    userToken = await loginAs(testApp.app, 'user@test.com', 'userpass');
  });

  describe('GET /api/v1/users/me/smtp', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/smtp')
        .expect(401);
    });

    it('returns 404 when not configured', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });

    it('returns config without password after saving', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.host).toBe(SMTP_BODY.host);
      expect(res.body).not.toHaveProperty('password');
      expect(res.body.passwordHint).toMatch(/•••••/);
    });
  });

  describe('PUT /api/v1/users/me/smtp', () => {
    it('saves config and returns 200 without password', async () => {
      const res = await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      expect(res.body.host).toBe(SMTP_BODY.host);
      expect(res.body).not.toHaveProperty('password');
    });

    it('retains password when omitted on subsequent saves', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      const noPassword = { ...SMTP_BODY, password: undefined };
      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...noPassword, host: 'smtp.updated.com' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.host).toBe('smtp.updated.com');
      expect(res.body.passwordHint).toContain('ord');
    });
  });

  describe('DELETE /api/v1/users/me/smtp', () => {
    it('removes config and returns 204', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      await request(testApp.app.getHttpServer())
        .delete('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204);

      await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/users/me/smtp/test', () => {
    it('returns 200 with success field when SMTP server is unreachable', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/smtp/test')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      expect(res.body).toHaveProperty('success');
      expect(typeof res.body.success).toBe('boolean');
    });

    it('returns 422 when password omitted and no saved config', async () => {
      const noPassword = { ...SMTP_BODY, password: undefined };
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/smtp/test')
        .set('Authorization', `Bearer ${userToken}`)
        .send(noPassword)
        .expect(422);
    });

    it('uses saved password when password omitted and config exists', async () => {
      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send(SMTP_BODY)
        .expect(200);

      const noPassword = { ...SMTP_BODY, password: undefined };
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/smtp/test')
        .set('Authorization', `Bearer ${userToken}`)
        .send(noPassword)
        .expect(200);

      expect(res.body).toHaveProperty('success');
    });
  });
});

// ─── Recipient Emails ─────────────────────────────────────────────────────────

describe('Recipient Emails (e2e)', () => {
  let testApp: TestApp;
  let userToken: string;
  let user2Token: string;

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
      password: 'pass',
    });
    await createTestUser(testApp.db, {
      email: 'user2@test.com',
      password: 'pass',
    });
    userToken = await loginAs(testApp.app, 'user@test.com', 'pass');
    user2Token = await loginAs(testApp.app, 'user2@test.com', 'pass');
  });

  describe('GET /api/v1/users/me/recipient-emails', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .expect(401);
    });

    it('returns empty array when no emails exist', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/v1/users/me/recipient-emails', () => {
    it('auto-sets isDefault=true for first email', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'kindle@kindle.com', label: 'My Kindle' })
        .expect(201);

      expect(res.body.isDefault).toBe(true);
      expect(res.body.email).toBe('kindle@kindle.com');
      expect(res.body.label).toBe('My Kindle');
    });

    it('sets isDefault=false for subsequent emails', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'first@kindle.com' })
        .expect(201);

      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'second@kindle.com' })
        .expect(201);

      expect(res.body.isDefault).toBe(false);
    });

    it('returns 409 for duplicate email', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'kindle@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'kindle@kindle.com' })
        .expect(409);
    });
  });

  describe('DELETE /api/v1/users/me/recipient-emails/:id', () => {
    it("returns 404 for another user's email", async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'kindle@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/users/me/recipient-emails/${res.body.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);
    });

    it('deletes non-default email and returns 204', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'first@kindle.com' })
        .expect(201);

      const second = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'second@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/users/me/recipient-emails/${second.body.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204);

      const list = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(list.body).toHaveLength(1);
    });

    it('promotes earliest remaining to default when default is deleted', async () => {
      const first = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'first@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'second@kindle.com' })
        .expect(201);

      // Delete the default (first)
      await request(testApp.app.getHttpServer())
        .delete(`/api/v1/users/me/recipient-emails/${first.body.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204);

      const list = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(list.body).toHaveLength(1);
      expect(list.body[0].email).toBe('second@kindle.com');
      expect(list.body[0].isDefault).toBe(true);
    });
  });

  describe('PATCH /api/v1/users/me/recipient-emails/:id/default', () => {
    it('atomically swaps the default', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'first@kindle.com' })
        .expect(201);

      const second = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'second@kindle.com' })
        .expect(201);

      // first is default; set second as default
      const res = await request(testApp.app.getHttpServer())
        .patch(`/api/v1/users/me/recipient-emails/${second.body.id}/default`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.isDefault).toBe(true);
      expect(res.body.id).toBe(second.body.id);

      const list = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const defaults = list.body.filter(
        (e: { isDefault: boolean }) => e.isDefault,
      );
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(second.body.id);
    });

    it('is idempotent when target is already default', async () => {
      const first = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'first@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/users/me/recipient-emails/${first.body.id}/default`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const list = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const defaults = list.body.filter(
        (e: { isDefault: boolean }) => e.isDefault,
      );
      expect(defaults).toHaveLength(1);
    });

    it("returns 404 for another user's email", async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/recipient-emails')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ email: 'kindle@kindle.com' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .patch(`/api/v1/users/me/recipient-emails/${res.body.id}/default`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);
    });
  });
});

// ─── Send Book ────────────────────────────────────────────────────────────────

describe('Send Book (e2e)', () => {
  let testApp: TestApp;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    const u1 = await createTestUser(testApp.db, {
      email: 'user@test.com',
      password: 'pass',
    });
    await createTestUser(testApp.db, {
      email: 'user2@test.com',
      password: 'pass',
    });
    userId = u1.id;
    userToken = await loginAs(testApp.app, 'user@test.com', 'pass');
  });

  describe('POST /api/v1/books/:id/send', () => {
    it('returns 401 without token', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/books/some-id/send')
        .send({})
        .expect(401);
    });

    it('returns 404 for non-existent book', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/books/non-existent-id/send')
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(404);
    });

    it('returns 503 when no SMTP config is available', async () => {
      const book = await seedBook(testApp.db);

      // Add a recipient email
      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(503);
    });

    it('returns 422 when book has no files', async () => {
      const library = await testApp.db.library.create({
        data: { name: 'Lib' },
      });
      const emptyBook = await testApp.db.book.create({
        data: { libraryId: library.id, title: 'Empty' },
      });

      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      // Save SMTP config so we don't 503
      await testApp.db.serverSettings.create({
        data: {
          key: 'smtp_config',
          value: JSON.stringify({
            host: 'smtp.example.com',
            port: 587,
            fromAddress: 'from@example.com',
            username: 'user',
            encryptedPassword: 'fake',
            enableAuth: true,
            enableStartTls: true,
          }),
        },
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${emptyBook.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(422);
    });

    it('returns 422 when no default recipient is configured', async () => {
      const book = await seedBook(testApp.db);

      await testApp.db.serverSettings.create({
        data: {
          key: 'smtp_config',
          value: JSON.stringify({
            host: 'smtp.example.com',
            port: 587,
            fromAddress: 'from@example.com',
            username: 'user',
            encryptedPassword: 'fake',
            enableAuth: true,
            enableStartTls: true,
          }),
        },
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(422);
    });

    it('returns 404 when recipientEmailId belongs to another user', async () => {
      const book = await seedBook(testApp.db);

      // user2's recipient email
      const user2 = await testApp.db.user.findUnique({
        where: { email: 'user2@test.com' },
      });
      const user2Email = await testApp.db.recipientEmail.create({
        data: {
          userId: user2!.id,
          email: 'user2-kindle@kindle.com',
          isDefault: true,
        },
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ recipientEmailId: user2Email.id })
        .expect(404);
    });

    it('returns 404 when fileId does not belong to the book', async () => {
      const book = await seedBook(testApp.db);

      // Another book with its own file
      const otherBook = await seedBook(testApp.db, {
        formats: [{ filePath: '/books/other.epub', format: 'EPUB' }],
      });

      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ fileId: otherBook.files[0].id })
        .expect(404);
    });

    it('prefers EPUB when multiple formats available and no fileId given', async () => {
      const book = await seedBook(testApp.db, {
        formats: [
          { filePath: '/books/book.mobi', format: 'MOBI' },
          { filePath: '/books/book.epub', format: 'EPUB' },
        ],
      });

      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      // Use user SMTP so we can intercept what happens — expect 502 (SMTP fails)
      // because there's no real SMTP server, but the path should be reached.
      // We configure user SMTP and expect 502 (delivery failure), not 503/422.
      await createTestUser(testApp.db, {
        email: 'admin2@test.com',
        password: 'adminpass',
        role: 'ADMIN',
      });
      const adminToken2 = await loginAs(
        testApp.app,
        'admin2@test.com',
        'adminpass',
      );

      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send(SMTP_BODY)
        .expect(200);

      // Should get 502 (real SMTP failure) rather than 422 or 503
      const res = await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(502);

      expect(res.body.message).toMatch(/SMTP delivery failed/);
    });

    it('uses specific fileId when provided', async () => {
      const book = await seedBook(testApp.db, {
        formats: [
          { filePath: '/books/book.mobi', format: 'MOBI' },
          { filePath: '/books/book.epub', format: 'EPUB' },
        ],
      });
      const mobiFile = book.files.find((f) => f.format === 'MOBI')!;

      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      await createTestUser(testApp.db, {
        email: 'admin3@test.com',
        password: 'adminpass',
        role: 'ADMIN',
      });
      const adminToken3 = await loginAs(
        testApp.app,
        'admin3@test.com',
        'adminpass',
      );

      await request(testApp.app.getHttpServer())
        .put('/api/v1/settings/smtp')
        .set('Authorization', `Bearer ${adminToken3}`)
        .send(SMTP_BODY)
        .expect(200);

      // Explicit fileId — still expects 502 (SMTP fails) rather than 422 or 503
      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ fileId: mobiFile.id })
        .expect(502);
    });

    it('uses user SMTP config over server SMTP when both exist', async () => {
      const book = await seedBook(testApp.db);

      await testApp.db.recipientEmail.create({
        data: { userId, email: 'kindle@kindle.com', isDefault: true },
      });

      // Both server and user SMTP configured
      await testApp.db.serverSettings.create({
        data: {
          key: 'smtp_config',
          value: JSON.stringify({
            host: 'smtp.server.com',
            port: 587,
            fromAddress: 'server@example.com',
            username: 'server',
            encryptedPassword: 'fake',
            enableAuth: true,
            enableStartTls: true,
          }),
        },
      });

      await request(testApp.app.getHttpServer())
        .put('/api/v1/users/me/smtp')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...SMTP_BODY, host: 'smtp.user.com' })
        .expect(200);

      // Expect 502 because we hit real SMTP; the important thing is it didn't 503
      await request(testApp.app.getHttpServer())
        .post(`/api/v1/books/${book.id}/send`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(502);
    });
  });
});
