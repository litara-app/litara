import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

const KO_USER = 'kotest';
const KO_PASS = 'abc123md5hash'; // pre-hashed as if KOReader sent it

async function enableKoReader(db: any) {
  await db.serverSettings.upsert({
    where: { key: 'koreader_enabled' },
    create: { key: 'koreader_enabled', value: 'true' },
    update: { value: 'true' },
  });
}

function seedKoReaderCredential(db: any, userId: string) {
  return db.koReaderCredential.create({
    data: { username: KO_USER, passwordHash: KO_PASS, userId },
  }) as Promise<unknown>;
}

describe('KOReader Sync (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
  });

  describe('GET /1/healthcheck', () => {
    it('returns OK regardless of koreader_enabled', async () => {
      await request(testApp.app.getHttpServer())
        .get('/1/healthcheck')
        .expect(200)
        .expect({ state: 'OK' });
    });
  });

  describe('when koreader is disabled', () => {
    it('POST /1/users/create returns 503', async () => {
      await request(testApp.app.getHttpServer())
        .post('/1/users/create')
        .send({ username: 'foo', password: 'bar' })
        .expect(503);
    });

    it('GET /1/users/auth returns 503', async () => {
      await request(testApp.app.getHttpServer())
        .get('/1/users/auth')
        .set('x-auth-user', KO_USER)
        .set('x-auth-key', KO_PASS)
        .expect(503);
    });
  });

  describe('when koreader is enabled', () => {
    let userId: string;

    beforeEach(async () => {
      await enableKoReader(testApp.db);
      const user = await createTestUser(testApp.db);
      userId = user.id;
    });

    describe('POST /1/users/create', () => {
      it('always returns 403 with registration disabled code', async () => {
        const res = await request(testApp.app.getHttpServer())
          .post('/1/users/create')
          .send({ username: 'anyone', password: 'anything' })
          .expect(403);
        expect(res.body.code).toBe(2005);
      });
    });

    describe('GET /1/users/auth', () => {
      it('returns 401 with no credentials', async () => {
        const res = await request(testApp.app.getHttpServer())
          .get('/1/users/auth')
          .expect(401);
        expect(res.body.message?.code ?? res.body.code).toBe(2001);
      });

      it('returns 401 with wrong password', async () => {
        await seedKoReaderCredential(testApp.db, userId);
        const res = await request(testApp.app.getHttpServer())
          .get('/1/users/auth')
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', 'wrong')
          .expect(401);
        expect(res.body.message?.code ?? res.body.code).toBe(2001);
      });

      it('returns 200 with correct credentials', async () => {
        await seedKoReaderCredential(testApp.db, userId);
        await request(testApp.app.getHttpServer())
          .get('/1/users/auth')
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .expect(200)
          .expect({ authorized: 'OK' });
      });
    });

    describe('PUT /1/syncs/progress + GET /1/syncs/progress/:doc', () => {
      const DOC_HASH = 'abc123deadbeef';

      it('returns {} for unknown document', async () => {
        await seedKoReaderCredential(testApp.db, userId);
        await request(testApp.app.getHttpServer())
          .get(`/1/syncs/progress/${DOC_HASH}`)
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .expect(200)
          .expect({});
      });

      it('updates progress and returns it', async () => {
        await seedKoReaderCredential(testApp.db, userId);

        // Create a book + bookFile with the matching koReaderHash
        const book = await testApp.db.book.create({ data: { title: 'Test' } });
        await testApp.db.bookFile.create({
          data: {
            bookId: book.id,
            filePath: '/fake/book.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024),
            koReaderHash: DOC_HASH,
          },
        });

        // Update progress
        const updateRes = await request(testApp.app.getHttpServer())
          .put('/1/syncs/progress')
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .send({
            document: DOC_HASH,
            percentage: 0.42,
            progress: 'epubcfi(/6/2[chapter1]!/4/2/2)',
            device: 'My Kindle',
            device_id: 'kindle-abc',
          })
          .expect(200);
        expect(updateRes.body.document).toBe(DOC_HASH);
        expect(typeof updateRes.body.timestamp).toBe('number');

        // Get progress back
        const getRes = await request(testApp.app.getHttpServer())
          .get(`/1/syncs/progress/${DOC_HASH}`)
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .expect(200);
        expect(getRes.body.document).toBe(DOC_HASH);
        expect(getRes.body.percentage).toBeCloseTo(0.42);
        expect(getRes.body.progress).toBe('epubcfi(/6/2[chapter1]!/4/2/2)');
        expect(getRes.body.device).toBe('My Kindle');
        expect(typeof getRes.body.timestamp).toBe('number');
      });

      it('returns valid response for unknown document hash (no crash)', async () => {
        await seedKoReaderCredential(testApp.db, userId);
        const res = await request(testApp.app.getHttpServer())
          .put('/1/syncs/progress')
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .send({
            document: 'unknownhash999',
            percentage: 0.1,
            progress: '10',
            device: 'Test Device',
          })
          .expect(200);
        expect(res.body.document).toBe('unknownhash999');
      });

      it('rejects missing required fields', async () => {
        await seedKoReaderCredential(testApp.db, userId);
        const res = await request(testApp.app.getHttpServer())
          .put('/1/syncs/progress')
          .set('x-auth-user', KO_USER)
          .set('x-auth-key', KO_PASS)
          .send({ document: DOC_HASH })
          .expect(400);
        expect(res.body.message?.code ?? res.body.code).toBe(2003);
      });
    });
  });

  describe('User credentials API', () => {
    let token: string;

    beforeEach(async () => {
      await createTestUser(testApp.db);
      token = await loginAs(testApp.app, 'test@test.com', 'password123');
    });

    it('returns null credential when none exists', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.credential).toBeNull();
    });

    it('creates and returns credentials', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'mykobo', password: 'md5hashhere' })
        .expect(201);
      expect(res.body.credential.username).toBe('mykobo');
    });

    it('rejects duplicate credential creation', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'mykobo', password: 'md5hashhere' })
        .expect(201);
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'mykobo2', password: 'md5hashhere' })
        .expect(409);
    });

    it('deletes credentials', async () => {
      await request(testApp.app.getHttpServer())
        .post('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'mykobo', password: 'md5hashhere' })
        .expect(201);
      await request(testApp.app.getHttpServer())
        .delete('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      const getRes = await request(testApp.app.getHttpServer())
        .get('/api/v1/users/me/koreader-credentials')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getRes.body.credential).toBeNull();
    });
  });
});
