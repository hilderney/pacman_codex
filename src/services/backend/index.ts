import { SupabaseAuth, supabaseConfigured } from './supabaseAuth';
import { SupabaseData } from './supabaseData';
import type { AuthAdapter, DataAdapter } from './types';

export type BackendMode = 'local' | 'supabase' | 'none';

export function resolveBackendMode(): BackendMode {
  const forced = String(import.meta.env.VITE_BACKEND ?? '').toLowerCase();
  if (forced === 'local') return 'local';
  if (forced === 'supabase') return supabaseConfigured() ? 'supabase' : 'none';
  // Localhost default: prefer the in-browser SQLite + mock Google stack so
  // accounts work without a remote project. Production builds keep Supabase.
  if (import.meta.env.DEV) return 'local';
  return supabaseConfigured() ? 'supabase' : 'none';
}

export interface BackendPair {
  mode: BackendMode;
  auth: AuthAdapter;
  data: DataAdapter;
}

/** Async so sql.js stays out of the production Supabase chunk. */
export async function createBackend(): Promise<BackendPair> {
  const mode = resolveBackendMode();
  if (mode === 'local') {
    const [{ MockGoogleAuth }, { SqliteData }] = await Promise.all([
      import('./mockAuth'),
      import('./sqliteData'),
    ]);
    return { mode, auth: new MockGoogleAuth(), data: new SqliteData() };
  }
  const auth = new SupabaseAuth();
  return {
    mode: auth.available ? 'supabase' : 'none',
    auth,
    data: new SupabaseData(auth.client),
  };
}

export type {
  AuthAdapter, DataAdapter, AuthSession, MockAccount, RankingRow, AchievementProfile,
} from './types';
export { BackendError } from './types';
