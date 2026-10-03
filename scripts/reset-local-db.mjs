/**
 * Clears the in-browser SQLite DB (IndexedDB) and mock Google caches.
 * Requires the local origin to be reachable (pnpm dev or pnpm preview).
 *
 *   pnpm reset:local-db
 *   NEON_LOCAL_URL=http://127.0.0.1:4173 pnpm reset:local-db
 */
import { chromium } from '@playwright/test';

const origin = process.env.NEON_LOCAL_URL ?? 'http://127.0.0.1:5173';
const IDB_NAME = 'neon-maze-local';
const MOCK_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(origin, { waitUntil: 'commit', timeout: 30_000 });
} catch (error) {
  console.error(`Could not open ${origin}. Start the app first (pnpm dev).`);
  console.error(String(error?.message ?? error));
  await browser.close();
  process.exit(1);
}

await page.evaluate(async ({ idbName, mockIds }) => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(idbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
    request.onblocked = () => resolve();
  });
  const keys = ['neon:local-auth-session', 'neon:ranking'];
  for (const id of mockIds) {
    keys.push(
      `neon:nickname:${id}`,
      `neon:pending:${id}`,
      `neon:achievement-events:${id}`,
      `neon:achievement-profile:${id}`,
      `neon:achievement-local:${id}`,
    );
  }
  for (const key of keys) localStorage.removeItem(key);
}, { idbName: IDB_NAME, mockIds: MOCK_IDS });

console.log(`Local SQLite + mock auth data cleared on ${origin}`);
await browser.close();
