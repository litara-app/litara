import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createOpdsUser } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

async function enableOpds(db: any) {
  await db.serverSettings.upsert({
    where: { key: 'opds_enabled' },
    create: { key: 'opds_enabled', value: 'true' },
    update: { value: 'true' },
  });
}

async function seedData(db: any) {
  const library = await db.library.create({
    data: { name: 'V2 Test Library' },
  });

  const author = await db.author.create({ data: { name: 'V2 Author' } });

  const book = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'V2 Test Book',
      description: 'A v2 test book',
      language: 'en',
      coverData: Buffer.from('fake-cover'),
      authors: { create: [{ authorId: author.id }] },
      files: {
        create: [
          {
            filePath: '/fake/v2test.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024 * 1024),
            fileHash: 'e'.repeat(64),
          },
        ],
      },
    },
    include: { files: true },
  });

  return { library, author, book };
}

describe('OPDS v2 (e2e)', () => {
  let testApp: TestApp;
  const USERNAME = 'opds2-user';
  const PASSWORD = 'opds2-secret';

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: true });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await createOpdsUser(testApp.db, {
      username: USERNAME,
      password: PASSWORD,
    });
    await enableOpds(testApp.db);
  });

  describe('GET /opds/v2 (root)', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer()).get('/opds/v2').expect(401);
    });

    it('returns 200 with correct content type', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/opds\+json/);
    });

    it('returns navigation feed with correct structure', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.body).toHaveProperty('metadata');
      expect(res.body).toHaveProperty('links');
      expect(res.body).toHaveProperty('navigation');
      expect(res.body.metadata.title).toBe('Litara Library');
    });

    it('returns 401 with wrong credentials', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v2')
        .auth(USERNAME, 'wrong-pass')
        .expect(401);
    });
  });

  describe('GET /opds/v2/publications', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v2/publications')
        .expect(401);
    });

    it('returns publications feed', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/publications')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/opds\+json/);
      expect(res.body).toHaveProperty('publications');
      expect(res.body.publications).toHaveLength(1);
    });

    it('includes correct publication metadata', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/publications')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      const pub = res.body.publications[0];
      expect(pub.metadata.title).toBe('V2 Test Book');
      expect(pub.metadata['@type']).toBe('http://schema.org/Book');
      expect(pub.links).toHaveLength(1);
      expect(pub.links[0].rel).toBe('http://opds-spec.org/acquisition');
      expect(pub.links[0].type).toBe('application/epub+zip');
    });

    it('includes cover images when book has cover', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/publications')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      const pub = res.body.publications[0];
      expect(pub.images).toHaveLength(2);
      expect(pub.images[0].rel).toBe('http://opds-spec.org/image');
    });

    it('returns totalItems in metadata', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/publications')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.body.metadata).toHaveProperty('totalItems', 1);
    });
  });

  describe('GET /opds/v2/new', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v2/new')
        .expect(401);
    });

    it('returns new arrivals feed', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/new')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/opds\+json/);
      expect(res.body.publications).toHaveLength(1);
      expect(res.body.metadata.title).toBe('New Arrivals');
    });
  });

  describe('GET /opds/v2/search', () => {
    it('returns 401 without auth', async () => {
      await request(testApp.app.getHttpServer())
        .get('/opds/v2/search?q=test')
        .expect(401);
    });

    it('returns matching publications', async () => {
      await seedData(testApp.db);

      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/search?q=V2')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/opds\+json/);
      expect(res.body.publications).toHaveLength(1);
      expect(res.body.publications[0].metadata.title).toBe('V2 Test Book');
    });

    it('returns empty publications for no matches', async () => {
      const res = await request(testApp.app.getHttpServer())
        .get('/opds/v2/search?q=nonexistent-xyz')
        .auth(USERNAME, PASSWORD)
        .expect(200);

      expect(res.body.publications).toHaveLength(0);
    });
  });
});
