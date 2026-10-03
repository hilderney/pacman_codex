import type { AchievementEvent, RunResult } from '../game/engine';
import { createBackend, resolveBackendMode, type AuthSession, type BackendMode, type DataAdapter, type AuthAdapter } from './backend';
import type { AchievementProfile, RankingRow } from './backend/types';
import { read, safeStorage, write } from './storage';

export type { RankingRow, AchievementProfile };
export type PendingRun = RunResult & { userId: string; submissionId: string };

export function queueRun(owner: string | null, result: RunResult) {
  // A guest run never acquires an owner later, including after Google login.
  if (!owner || result.score <= 0) return;
  const old = read<PendingRun | null>(`pending:${owner}`, null);
  if (!old || result.score > old.score || (result.score === old.score && result.level > old.level))
    write(`pending:${owner}`, { ...result, userId: owner, submissionId: crypto.randomUUID() });
}
export function queueAchievement(owner: string | null, event: AchievementEvent) {
  if (!owner) return;
  const key = `achievement-events:${owner}`;
  const queued = read<AchievementEvent[]>(key, []);
  if (!queued.some(item => item.runId === event.runId && item.sequence === event.sequence)) {
    queued.push(event); write(key, queued);
  }
}

export class Network {
  /** @deprecated Prefer `available`; kept for older call sites/tests. */
  client: { kind: BackendMode } | null = null;
  session: AuthSession | null = null;
  nickname: string | null = null;
  profileReady = false;
  mode: BackendMode = 'none';
  onChange: () => void = () => {};
  onAchievements: (slugs: string[]) => void = () => {};
  onSyncState: (updating: boolean) => void = () => {};
  onSyncComplete: () => void = () => {};
  private auth: AuthAdapter | null = null;
  private data: DataAdapter | null = null;
  private flushing: Promise<'none' | 'pending' | 'synced' | 'rejected'> | null = null;
  private achievementFlush: Promise<void> | null = null;
  private pendingFlush: Promise<['none' | 'pending' | 'synced' | 'rejected', void]> | null = null;
  private syncOperations = 0;
  private boot: Promise<void> | null = null;
  private initialized = false;

  constructor(auth?: AuthAdapter, data?: DataAdapter) {
    if (auth && data) {
      this.bind(auth, data);
    } else {
      this.mode = resolveBackendMode();
      this.client = this.mode === 'none' ? null : { kind: this.mode };
    }
  }

  private bind(auth: AuthAdapter, data: DataAdapter) {
    this.auth = auth;
    this.data = data;
    this.mode = auth.kind;
    this.client = auth.available ? { kind: this.mode } : null;
  }

  get available() {
    if (this.auth) return this.auth.available;
    return this.mode === 'local' || this.mode === 'supabase';
  }
  get isLocal() { return this.mode === 'local'; }
  get updating() { return this.syncOperations > 0; }
  hasPendingData() {
    const id = this.session?.user.id;
    if (!id) return false;
    return read<PendingRun | null>(`pending:${id}`, null) !== null
      || read<AchievementEvent[]>(`achievement-events:${id}`, []).length > 0;
  }
  listMockAccounts() { return this.auth?.listMockAccounts?.() ?? []; }

  private async ensureBackend() {
    if (this.auth && this.data) return;
    if (!this.boot) {
      this.boot = createBackend().then(backend => this.bind(backend.auth, backend.data));
    }
    await this.boot;
  }

  async init() {
    await this.ensureBackend();
    if (!this.auth?.available || !this.data || this.initialized) return;
    this.initialized = true;
    await Promise.all([this.auth.init(), this.data.init()]);
    this.auth.onAuthStateChange((event, session) => {
      if (session?.user.id !== this.session?.user.id) this.profileReady = false;
      this.session = session;
      this.nickname = session ? read<string | null>(`nickname:${session.user.id}`, null) : null;
      this.onChange();
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(() => void this.loginSync(), 0);
    });
    this.session = this.auth.getSession();
    if (this.session) this.nickname = read(`nickname:${this.session.user.id}`, null);
    this.onChange();
    if (this.session) setTimeout(() => void this.loginSync(), 0);
  }

  async loginSync() {
    await this.ensureBackend();
    const userId = this.session?.user.id;
    if (!this.auth?.available || !userId || !navigator.onLine || !this.data?.ready) return;
    try {
      const nickname = await this.data.getNickname(userId);
      if (this.session?.user.id !== userId) return;
      this.profileReady = true;
      if (nickname) { this.nickname = nickname; write(`nickname:${userId}`, nickname); }
      this.onChange();
    } catch { /* Retry at the next explicit sync point. */ }
  }

  async signIn(accountId?: string) {
    await this.ensureBackend();
    if (!this.auth?.available || !navigator.onLine) throw new Error('unavailable');
    await this.auth.signInWithGoogle(accountId);
    this.session = this.auth.getSession();
    if (this.session) this.nickname = read(`nickname:${this.session.user.id}`, null);
    this.onChange();
  }

  async signOut() {
    await this.ensureBackend();
    try { await this.auth?.signOut(); }
    finally { this.session = null; this.nickname = null; this.onChange(); }
  }

  async claim(nickname: string) {
    await this.ensureBackend();
    if (!this.auth?.available || !this.session || !navigator.onLine || !this.data?.ready) throw new Error('offline');
    await this.data.claimNickname(this.session.user.id, nickname);
    this.nickname = nickname; write(`nickname:${this.session.user.id}`, nickname); this.onChange();
  }

  flush(): Promise<'none' | 'pending' | 'synced' | 'rejected'> {
    if (this.flushing) return this.flushing;
    this.beginSync();
    this.flushing = this.flushOne().finally(() => { this.flushing = null; this.endSync(); });
    return this.flushing;
  }
  flushAchievements(): Promise<void> {
    if (this.achievementFlush) return this.achievementFlush;
    this.beginSync();
    this.achievementFlush = this.flushAchievementQueue().finally(() => { this.achievementFlush = null; this.endSync(); });
    return this.achievementFlush;
  }
  flushPending(): Promise<['none' | 'pending' | 'synced' | 'rejected', void]> {
    if (this.pendingFlush) return this.pendingFlush;
    const id = this.session?.user.id;
    const hadScore = id ? read<PendingRun | null>(`pending:${id}`, null) !== null : false;
    const achievementsBefore = id ? read<AchievementEvent[]>(`achievement-events:${id}`, []).length : 0;
    this.pendingFlush = Promise.all([this.flush(), this.flushAchievements()]).then(result => {
      const achievementsAfter = id ? read<AchievementEvent[]>(`achievement-events:${id}`, []).length : achievementsBefore;
      if ((hadScore && result[0] === 'synced') || achievementsAfter < achievementsBefore) this.onSyncComplete();
      return result;
    }).finally(() => { this.pendingFlush = null; });
    return this.pendingFlush;
  }
  pendingAchievements() {
    const id = this.session?.user.id;
    return id ? read<AchievementEvent[]>(`achievement-events:${id}`, []).length : 0;
  }

  private async flushAchievementQueue() {
    await this.ensureBackend();
    const id = this.session?.user.id;
    if (!id || !this.auth?.available || !this.nickname || !navigator.onLine || !this.data?.ready) return;
    const key = `achievement-events:${id}`;
    while (this.session?.user.id === id && navigator.onLine) {
      const batch = read<AchievementEvent[]>(key, []).slice(0, 32);
      if (!batch.length) return;
      try {
        const { data, error } = await this.data.submitAchievementEvents(id, batch);
        if (error) return;
        const sent = new Set(batch.map(event => `${event.runId}:${event.sequence}`));
        write(key, read<AchievementEvent[]>(key, []).filter(event => !sent.has(`${event.runId}:${event.sequence}`)));
        if (Array.isArray(data) && data.length) this.onAchievements(data);
      } catch { return; }
    }
  }

  private beginSync() {
    if (this.syncOperations++ === 0) this.onSyncState(true);
  }
  private endSync() {
    this.syncOperations = Math.max(0, this.syncOperations - 1);
    if (this.syncOperations === 0) this.onSyncState(false);
  }

  private async flushOne(): Promise<'none' | 'pending' | 'synced' | 'rejected'> {
    await this.ensureBackend();
    const id = this.session?.user.id;
    if (!id || !this.auth?.available || !this.data) return 'none';
    const run = read<PendingRun | null>(`pending:${id}`, null);
    if (!run || run.userId !== id) return 'none';
    if (!navigator.onLine || !this.nickname || !this.data.ready) return 'pending';
    try {
      const { error } = await this.data.submitScore(id, {
        score: run.score, level: run.level, durationMs: run.durationMs, runId: run.submissionId ?? run.runId,
      });
      const permanent = error && (error.code === '22023' || error.code === '23514');
      if (!error || permanent) {
        const current = read<PendingRun | null>(`pending:${id}`, null);
        if (current?.submissionId === run.submissionId) safeStorage.removeItem(`neon:pending:${id}`);
        else if (current && !permanent) setTimeout(() => void this.flush(), 0);
        return permanent ? 'rejected' : 'synced';
      }
      return 'pending';
    } catch { return 'pending'; }
  }

  async ranking(): Promise<{ rows: RankingRow[]; cached: boolean; available: boolean }> {
    await this.ensureBackend();
    const cache = read<RankingRow[]>('ranking', []);
    if (!this.auth?.available || !navigator.onLine || !this.data?.ready) {
      return { rows: Array.isArray(cache) ? cache : [], cached: true, available: cache.length > 0 };
    }
    try {
      const rows = await this.data.ranking();
      write('ranking', rows);
      return { rows, cached: false, available: true };
    } catch {
      return { rows: Array.isArray(cache) ? cache : [], cached: true, available: cache.length > 0 };
    }
  }

  async profile(): Promise<AchievementProfile> {
    await this.ensureBackend();
    const id = this.session?.user.id;
    const empty: AchievementProfile = { definitions: [], awards: [], candidates: [], bestScore: 0, levelReached: 0, cached: false, available: false };
    if (!id) return empty;
    const cached = read<AchievementProfile>(`achievement-profile:${id}`, empty);
    if (!this.auth?.available || !navigator.onLine || !this.data?.ready) return { ...cached, cached: true };
    try {
      const result = { ...(await this.data.profile(id)), cached: false, available: true };
      write(`achievement-profile:${id}`, result);
      return result;
    } catch {
      return { ...cached, cached: true };
    }
  }
}
