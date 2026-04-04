import request from 'supertest';
import { TestApp, createTestApp } from './helpers/app.helper';
import { createTestUser, loginAs } from './helpers/auth.helper';
import { cleanDatabase } from './helpers/db.helper';

describe('Shelves (e2e)', () => {
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

  it('GET /shelves returns empty array when no shelves exist', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/api/v1/shelves')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('GET /shelves/:id/books returns empty array for a new shelf', async () => {
    const shelf = await testApp.db.shelf.create({
      data: { name: 'Empty Shelf', userId },
    });

    const res = await request(testApp.app.getHttpServer())
      .get(`/api/v1/shelves/${shelf.id}/books`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('GET /shelves/:id/books returns the book after PUT /books/:id/shelves assigns it', async () => {
    // Seed a library and book so we have something to assign
    const library = await testApp.db.library.create({
      data: { name: 'Default Library' },
    });
    const book = await testApp.db.book.create({
      data: {
        libraryId: library.id,
        title: 'Shelf Test Book',
        files: {
          create: [
            {
              filePath: '/fake/shelf.epub',
              format: 'EPUB',
              sizeBytes: BigInt(1024),
              fileHash: 'c'.repeat(64),
            },
          ],
        },
      },
    });

    const shelf = await testApp.db.shelf.create({
      data: { name: 'Test Shelf', userId },
    });

    await request(testApp.app.getHttpServer())
      .put(`/api/v1/books/${book.id}/shelves`)
      .set('Authorization', `Bearer ${token}`)
      .send({ shelfIds: [shelf.id] })
      .expect(200);

    const res = await request(testApp.app.getHttpServer())
      .get(`/api/v1/shelves/${shelf.id}/books`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Shelf Test Book');
  });

  it('PATCH /shelves/:id renames the shelf', async () => {
    const shelf = await testApp.db.shelf.create({
      data: { name: 'Old Name', userId },
    });

    await request(testApp.app.getHttpServer())
      .patch(`/api/v1/shelves/${shelf.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })
      .expect(200);

    const updated = await testApp.db.shelf.findUnique({
      where: { id: shelf.id },
    });
    expect(updated?.name).toBe('New Name');
  });

  it('GET /shelves/:id returns the shelf', async () => {
    const shelf = await testApp.db.shelf.create({
      data: { name: 'My Shelf', userId },
    });

    const res = await request(testApp.app.getHttpServer())
      .get(`/api/v1/shelves/${shelf.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ id: shelf.id, name: 'My Shelf' });
  });

  it('POST /shelves creates and returns a new shelf', async () => {
    const res = await request(testApp.app.getHttpServer())
      .post('/api/v1/shelves')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Weekend Reads' })
      .expect(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'Weekend Reads');
  });

  it('GET /shelves returns manually created shelves', async () => {
    await testApp.db.shelf.create({ data: { name: 'Favorites', userId } });
    await testApp.db.shelf.create({ data: { name: 'To Read', userId } });

    const res = await request(testApp.app.getHttpServer())
      .get('/api/v1/shelves')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(2);
    const names = (res.body as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('Favorites');
    expect(names).toContain('To Read');
  });

  it('PATCH /shelves/:id returns 404 for a nonexistent shelf', async () => {
    await request(testApp.app.getHttpServer())
      .patch('/api/v1/shelves/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' })
      .expect(404);
  });

  it('GET /shelves/:id/books returns 404 for a nonexistent shelf', async () => {
    await request(testApp.app.getHttpServer())
      .get('/api/v1/shelves/00000000-0000-0000-0000-000000000000/books')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("GET /shelves/:id returns 404 for another user's shelf", async () => {
    // Create a second user and their shelf
    const otherUser = await createTestUser(testApp.db, {
      email: 'other@test.com',
      password: 'pass456',
    });
    const otherShelf = await testApp.db.shelf.create({
      data: { name: 'Private Shelf', userId: otherUser.id },
    });

    // First user tries to access it
    await request(testApp.app.getHttpServer())
      .get(`/api/v1/shelves/${otherShelf.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
