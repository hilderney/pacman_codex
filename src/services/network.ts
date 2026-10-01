import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { RunResult } from '../game/engine';
import { read, safeStorage, write } from './storage';

export interface RankingRow { user_id: string; nickname: string; best_score: number; level_reached: number }
export type PendingRun = RunResult & { userId: string };
export function queueRun(owner: string | null, result: RunResult) {
  // A guest run never acquires an owner later, including after Google login.
  if (!owner || result.score <= 0) return;
  const old = read<PendingRun | null>(`pending:${owner}`, null);
  if (!old || result.score > old.score || (result.score === old.score && result.level > old.level))
    write(`pending:${owner}`, { ...result, userId: owner });
}

export class Network {
  client: SupabaseClient | null = null;
  session: Session | null = null;
  nickname: string | null = null;
  profileReady = false;
  onChange: () => void = () => {};
  private flushing: Promise<'none' | 'pending' | 'synced' | 'rejected'> | null = null;
  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL, token = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) && token && !token.includes('YOUR_')) {
      this.client = createClient(url, token, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storage: safeStorage },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
      });
    }
  }
  async init() {
    if (!this.client) return;
    this.client.auth.onAuthStateChange((event, session) => {
      if (session?.user.id !== this.session?.user.id) this.profileReady = false;
      this.session = session;
      this.nickname = session ? read<string | null>(`nickname:${session.user.id}`, null) : null;
      this.onChange();
      // Do not await another Supabase request inside the auth lock callback.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(() => void this.loginSync(), 0);
    });
    try {
      const { data } = await this.client.auth.getSession(); this.session = data.session;
      if (this.session) this.nickname = read(`nickname:${this.session.user.id}`, null);
      this.onChange();
    } catch { /* Cached/offline play stays available. */ }
  }
  async loginSync() {
    const userId = this.session?.user.id;
    if (!this.client || !userId || !navigator.onLine) return;
    try {
      const { data, error } = await this.client.from('profiles').select('nickname').eq('user_id', userId).maybeSingle();
      if (this.session?.user.id !== userId) return;
      this.profileReady = !error;
      if (data) { this.nickname = data.nickname; write(`nickname:${userId}`, data.nickname); }
      this.onChange(); await this.flush();
    } catch { /* Retry at the next explicit sync point. */ }
  }
  async signIn() {
    if (!this.client || !navigator.onLine) throw new Error('unavailable');
    const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
    if (error) throw error;
  }
  async signOut() {
    try { await this.client?.auth.signOut({ scope: 'local' }); } finally { this.session = null; this.nickname = null; this.onChange(); }
  }
  async claim(nickname: string) {
    if (!this.client || !this.session || !navigator.onLine) throw new Error('offline');
    const { error } = await this.client.rpc('claim_nickname', { p_nickname: nickname });
    if (error) throw error;
    this.nickname = nickname; write(`nickname:${this.session.user.id}`, nickname); this.onChange();
  }
  flush(): Promise<'none' | 'pending' | 'synced' | 'rejected'> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushOne().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async flushOne(): Promise<'none' | 'pending' | 'synced' | 'rejected'> {
    const id = this.session?.user.id;
    if (!id || !this.client) return 'none';
    const run = read<PendingRun | null>(`pending:${id}`, null);
    if (!run || run.userId !== id) return 'none';
    if (!navigator.onLine || !this.nickname) return 'pending';
    try {
      const { error } = await this.client.rpc('submit_score', {
        p_score: run.score, p_level: run.level, p_duration_ms: run.durationMs, p_run_id: run.runId,
      });
      const permanent = error && (error.code === '22023' || error.code === '23514');
      if (!error || permanent) {
        // Never erase a newer run queued while this request was in flight.
        if (read<PendingRun | null>(`pending:${id}`, null)?.runId === run.runId) safeStorage.removeItem(`neon:pending:${id}`);
        return permanent ? 'rejected' : 'synced';
      }
      return 'pending';
    } catch { return 'pending'; }
  }
  async ranking(): Promise<{ rows: RankingRow[]; cached: boolean; available: boolean }> {
    await this.flush();
    const cache = read<RankingRow[]>('ranking', []);
    if (!this.client || !navigator.onLine) return { rows: Array.isArray(cache) ? cache : [], cached: true, available: cache.length > 0 };
    try {
      const { data, error } = await this.client.from('scores')
        .select('user_id,best_score,level_reached,profiles!inner(nickname)')
        .order('best_score', { ascending: false }).order('updated_at', { ascending: true }).order('user_id').limit(20);
      if (error) throw error;
      const rows = (data ?? []).map(row => ({
        user_id: row.user_id, best_score: row.best_score, level_reached: row.level_reached,
        nickname: (row.profiles as unknown as { nickname: string }).nickname,
      }));
      write('ranking', rows); return { rows, cached: false, available: true };
    } catch { return { rows: Array.isArray(cache) ? cache : [], cached: true, available: cache.length > 0 }; }
  }
}
