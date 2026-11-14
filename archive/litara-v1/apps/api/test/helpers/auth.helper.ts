import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../../src/database/database.service';

export async function createTestUser(
  db: DatabaseService,
  opts?: { email?: string; password?: string; role?: 'USER' | 'ADMIN' },
) {
  const email = opts?.email ?? 'test@test.com';
  const password = opts?.password ?? 'password123';
  const hash = await bcrypt.hash(password, 10);
  return db.user.create({
    data: { email, password: hash, role: opts?.role ?? 'USER' },
  });
}

export async function createOpdsUser(
  db: DatabaseService,
  opts?: { username?: string; password?: string },
) {
  const username = opts?.username ?? 'opds-user';
  const password = opts?.password ?? 'password123';
  const hash = await bcrypt.hash(password, 10);
  return db.opdsUser.create({
    data: { username, password: hash },
  });
}

export async function loginAs(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(201);
  return res.body.access_token as string;
}
