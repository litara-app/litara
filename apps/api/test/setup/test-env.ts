import path from 'path';
import fs from 'fs';

// Read the PostgreSQL URL written by globalSetup (Testcontainers).
// The state file sits at apps/api/test/.testcontainer-state.json.
const STATE_FILE = path.resolve(__dirname, '..', '.testcontainer-state.json');

try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as {
    url: string;
  };
  process.env.DATABASE_URL = state.url;
} catch {
  // Fall back so IDE-level test runs still work if a container isn't active.
  process.env.DATABASE_URL =
    'postgresql://postgres:postgres@localhost:5432/litara_test';
}

process.env.JWT_SECRET = 'test-secret-key-do-not-use-in-prod';
process.env.NODE_ENV = 'test';

// Resolve the shared ebook-library path:
// apps/api/test/setup/ → ../../../../test/fixtures/ebook-library/
process.env.EBOOK_LIBRARY_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'ebook-library',
);
