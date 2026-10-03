import type { AchievementEvent } from '../../game/engine';

/** Minimal auth user shape shared by Supabase and the local Google mock. */
export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  user: AuthUser;
}

export type AuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

export class BackendError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'BackendError';
  }
}

export interface MockAccount {
  id: string;
  email: string;
  name: string;
}

export interface RankingRow {
  user_id: string;
  nickname: string;
  best_score: number;
  level_reached: number;
}

export interface AchievementProfile {
  definitions: { slug: string; family_key: string; tier: number; badge_key: string; exclusive: boolean }[];
  awards: { slug: string; user_id: string; awarded_at: string; nickname?: string }[];
  candidates: { slug: string; queue_position: number }[];
  bestScore: number;
  levelReached: number;
  cached: boolean;
  available: boolean;
}

export interface AuthAdapter {
  readonly kind: 'supabase' | 'local';
  /** True when sign-in and online features can be offered. */
  readonly available: boolean;
  init(): Promise<void>;
  getSession(): AuthSession | null;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: AuthSession | null) => void): () => void;
  /** Local mock may receive an account id; Supabase ignores the argument. */
  signInWithGoogle(accountId?: string): Promise<void>;
  signOut(): Promise<void>;
  /** Present only on the local mock so the UI can offer Alice/Bob/Carol. */
  listMockAccounts?(): MockAccount[];
}

export interface DataAdapter {
  readonly kind: 'supabase' | 'local';
  ready: boolean;
  init(): Promise<void>;
  getNickname(userId: string): Promise<string | null>;
  claimNickname(userId: string, nickname: string): Promise<void>;
  submitScore(userId: string, params: {
    score: number; level: number; durationMs: number; runId: string;
  }): Promise<{ error: BackendError | null }>;
  submitAchievementEvents(userId: string, events: AchievementEvent[]): Promise<{ data: string[] | null; error: BackendError | null }>;
  ranking(): Promise<RankingRow[]>;
  profile(userId: string): Promise<Omit<AchievementProfile, 'cached' | 'available'>>;
}
