import { MOCK_ACCOUNTS } from './mockAuth';
import { LOCAL_SQLITE_IDB_NAME } from './sqliteStore';

/** localStorage keys tied to the in-browser SQLite / mock Google stack. */
export function localBackendStorageKeys(): string[] {
  const keys = ['neon:local-auth-session', 'neon:ranking'];
  for (const account of MOCK_ACCOUNTS) {
    keys.push(
      `neon:nickname:${account.id}`,
      `neon:pending:${account.id}`,
      `neon:achievement-events:${account.id}`,
      `neon:achievement-profile:${account.id}`,
      `neon:achievement-local:${account.id}`,
    );
  }
  return keys;
}

/** Wipe the local sql.js database and related mock-auth caches (browser only). */
export async function resetLocalBackend(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_SQLITE_IDB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete local SQLite'));
    // Another tab may hold the DB open; deletion still completes after they close.
    request.onblocked = () => resolve();
  });
  for (const key of localBackendStorageKeys()) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
