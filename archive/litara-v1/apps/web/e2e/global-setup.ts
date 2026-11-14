import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const AUTH_STATE_PATH = path.join(__dirname, '.auth.json');

export const E2E_USER = {
  email: 'e2e-admin@litara.test',
  password: 'E2eTestPassword1!',
  name: 'E2E Admin',
};

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 401 || res.status === 403) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

async function ensureUser(): Promise<{ token: string; user: object }> {
  // Try login first (user may already exist from a previous run)
  const loginRes = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: E2E_USER.email,
      password: E2E_USER.password,
    }),
  });

  if (loginRes.ok) {
    return loginRes.json() as Promise<{ token: string; user: object }>;
  }

  // Check if setup is needed
  const statusRes = await fetch(`${API_URL}/api/v1/setup/status`);
  const { setupRequired } = (await statusRes.json()) as {
    setupRequired: boolean;
  };

  if (setupRequired) {
    const setupRes = await fetch(`${API_URL}/api/v1/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(E2E_USER),
    });
    if (!setupRes.ok) {
      throw new Error(
        `Setup failed: ${setupRes.status} ${await setupRes.text()}`,
      );
    }
    return setupRes.json() as Promise<{ token: string; user: object }>;
  }

  throw new Error(
    `Could not authenticate e2e user (${E2E_USER.email}) — setup is complete but login failed. ` +
      'Run the API e2e suite first to reset the database, or clear it manually.',
  );
}

export default async function globalSetup(): Promise<void> {
  console.log('[e2e] Waiting for API...');
  await waitForServer(`${API_URL}/api/v1/setup/status`);
  console.log('[e2e] API ready.');

  const { access_token: token, user } = (await ensureUser()) as {
    access_token: string;
    user: object;
  };

  // Build a Playwright storageState that pre-seeds localStorage with the JWT
  // so tests skip the login flow. The origin must match the SPA's origin.
  const storageState = {
    cookies: [] as unknown[],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [
          { name: 'token', value: token },
          { name: 'user', value: JSON.stringify(user) },
        ],
      },
    ],
  };

  fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(storageState, null, 2));
  console.log('[e2e] Auth state saved to', AUTH_STATE_PATH);
}
