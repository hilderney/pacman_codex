import type { SupabaseClient } from '@supabase/supabase-js';
import type { AchievementEvent } from '../../game/engine';
import { BackendError, type AchievementProfile, type DataAdapter, type RankingRow } from './types';

export class SupabaseData implements DataAdapter {
  readonly kind = 'supabase' as const;
  ready = false;

  constructor(private client: SupabaseClient | null) {
    this.ready = client !== null;
  }

  async init() { /* Supabase client is ready in the constructor. */ }

  async getNickname(userId: string) {
    if (!this.client) return null;
    const { data, error } = await this.client.from('profiles').select('nickname').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.nickname ?? null;
  }

  async claimNickname(_userId: string, nickname: string) {
    if (!this.client) throw new BackendError('offline', 'P0001');
    const { error } = await this.client.rpc('claim_nickname', { p_nickname: nickname });
    if (error) throw new BackendError(error.message, error.code ?? 'P0001');
  }

  async submitScore(_userId: string, params: { score: number; level: number; durationMs: number; runId: string }) {
    if (!this.client) return { error: new BackendError('unavailable', 'P0001') };
    const { error } = await this.client.rpc('submit_score', {
      p_score: params.score, p_level: params.level, p_duration_ms: params.durationMs, p_run_id: params.runId,
    });
    return { error: error ? new BackendError(error.message, error.code ?? 'P0001') : null };
  }

  async submitAchievementEvents(_userId: string, events: AchievementEvent[]) {
    if (!this.client) return { data: null, error: new BackendError('unavailable', 'P0001') };
    const { data, error } = await this.client.rpc('submit_achievement_events', { p_events: events });
    return {
      data: Array.isArray(data) ? data.filter((slug): slug is string => typeof slug === 'string') : null,
      error: error ? new BackendError(error.message, error.code ?? 'P0001') : null,
    };
  }

  async ranking(): Promise<RankingRow[]> {
    if (!this.client) throw new BackendError('unavailable', 'P0001');
    const { data, error } = await this.client.from('scores')
      .select('user_id,best_score,level_reached,profiles!inner(nickname)')
      .order('best_score', { ascending: false }).order('updated_at', { ascending: true }).order('user_id').limit(20);
    if (error) throw error;
    return (data ?? []).map(row => ({
      user_id: row.user_id, best_score: row.best_score, level_reached: row.level_reached,
      nickname: (row.profiles as unknown as { nickname: string }).nickname,
    }));
  }

  async profile(userId: string): Promise<Omit<AchievementProfile, 'cached' | 'available'>> {
    if (!this.client) throw new BackendError('unavailable', 'P0001');
    const [definitions, common, exclusive, score, candidates] = await Promise.all([
      this.client.from('achievement_definitions').select('slug,family_key,tier,badge_key,exclusive').eq('active', true).order('sort_order'),
      this.client.from('player_achievements').select('slug,user_id,awarded_at').eq('user_id', userId),
      this.client.from('exclusive_holders').select('slug,user_id,awarded_at,profiles(nickname)'),
      this.client.from('scores').select('best_score,level_reached').eq('user_id', userId).maybeSingle(),
      this.client.rpc('my_achievement_candidates'),
    ]);
    if (definitions.error || common.error || exclusive.error || score.error || candidates.error) {
      throw new BackendError('profile unavailable', 'P0001');
    }
    return {
      definitions: definitions.data ?? [],
      awards: [
        ...(common.data ?? []),
        ...(exclusive.data ?? []).map(row => ({
          slug: row.slug, user_id: row.user_id, awarded_at: row.awarded_at,
          nickname: (row.profiles as unknown as { nickname: string } | null)?.nickname,
        })),
      ],
      candidates: candidates.data ?? [],
      bestScore: Number(score.data?.best_score ?? 0),
      levelReached: Number(score.data?.level_reached ?? 0),
    };
  }
}
