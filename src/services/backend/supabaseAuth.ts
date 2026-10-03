import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { safeStorage } from '../storage';
import type { AuthAdapter, AuthChangeEvent, AuthSession } from './types';

function mapSession(session: Session | null): AuthSession | null {
  if (!session?.user) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      user_metadata: session.user.user_metadata as Record<string, unknown>,
    },
  };
}

export function supabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const token = import.meta.env.VITE_SUPABASE_PUB_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) && token && !token.includes('YOUR_'));
}

export class SupabaseAuth implements AuthAdapter {
  readonly kind = 'supabase' as const;
  client: SupabaseClient | null = null;
  private session: AuthSession | null = null;

  get available() { return this.client !== null; }

  constructor() {
    if (!supabaseConfigured()) return;
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const token = (import.meta.env.VITE_SUPABASE_PUB_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string;
    this.client = createClient(url, token, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storage: safeStorage },
      global: { fetch: (input, init) => fetch(input, { ...init, keepalive: true, signal: AbortSignal.timeout(8000) }) },
    });
  }

  async init() {
    if (!this.client) return;
    try {
      const { data } = await this.client.auth.getSession();
      this.session = mapSession(data.session);
    } catch { /* Cached/offline play stays available. */ }
  }

  getSession() { return this.session; }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: AuthSession | null) => void) {
    if (!this.client) return () => {};
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      this.session = mapSession(session);
      callback(event as AuthChangeEvent, this.session);
    });
    return () => data.subscription.unsubscribe();
  }

  async signInWithGoogle() {
    if (!this.client || !navigator.onLine) throw new Error('unavailable');
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: location.origin + '/' },
    });
    if (error) throw error;
  }

  async signOut() {
    try { await this.client?.auth.signOut({ scope: 'local' }); }
    finally { this.session = null; }
  }
}
