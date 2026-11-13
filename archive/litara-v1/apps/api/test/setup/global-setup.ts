import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Shared state file: readable by test workers via test-env.ts (setupFiles).
export const STATE_FILE = path.resolve(
  __dirname,
  '..',
  '.testcontainer-state.json',
);

// Stored on global so globalTeardown (same process) can stop the container.
declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer;
}

export default async function globalSetup(): Promise<void> {
  console.log('[e2e] Starting PostgreSQL container via Testcontainers...');

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('litara_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const url = container.getConnectionUri();
  console.log(`[e2e] PostgreSQL container ready at ${url}`);

  // Persist for globalTeardown (same process).
  global.__PG_CONTAINER__ = container;

  // Write the URL to a file so test worker processes (setupFiles) can read it.
  fs.writeFileSync(STATE_FILE, JSON.stringify({ url }), 'utf-8');

  // Apply all migrations to the fresh container database.
  const apiDir = path.resolve(__dirname, '../..');
  console.log('[e2e] Running prisma migrate deploy...');
  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  console.log('[e2e] Migrations applied successfully');
}
