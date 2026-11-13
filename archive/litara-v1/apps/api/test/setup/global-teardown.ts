import fs from 'fs';
import { STATE_FILE } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const container = global.__PG_CONTAINER__;
  if (container) {
    console.log('[e2e] Stopping PostgreSQL container...');
    await container.stop();
    console.log('[e2e] Container stopped');
  }

  // Remove the state file written by globalSetup.
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}
