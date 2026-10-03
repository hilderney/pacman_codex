import type { AchievementEvent } from '../../game/engine';
import { achievementThreshold } from '../../achievements/config';
import { BackendError, type AchievementProfile, type DataAdapter, type RankingRow } from './types';
import { SqliteStore } from './sqliteStore';

const MAX_SAFE = 9007199254740991;
const NICKNAME_RE = /^[A-Za-z0-9_]{3,12}$/;
const KINDS = new Set(['clear', 'death', 'over', 'power', 'capture', 'tunnel', 'peak']);

interface RunState {
  user_id: string;
  run_id: string;
  last_sequence: number;
  elapsed_ms: number;
  cleared: number;
  deaths: number;
  screen_deaths: number;
  peak: number;
  tunnel_count: number;
  power_id: number;
  power_started_ms: number;
  captures: number;
  ended: number;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

/** Browser SQLite stand-in for Supabase RPCs/tables used by Network. */
export class SqliteData implements DataAdapter {
  readonly kind = 'local' as const;
  ready = false;
  private store = new SqliteStore();

  async init() {
    await this.store.open();
    this.ready = true;
    this.captureDailyLeader(utcDay());
  }

  async getNickname(userId: string) {
    return this.store.scalar<string>('select nickname from profiles where user_id = ?', [userId]);
  }

  async claimNickname(userId: string, nickname: string) {
    const name = nickname.trim();
    if (!NICKNAME_RE.test(name)) throw new BackendError('Invalid nickname', '22023');
    const existing = this.store.scalar<string>('select nickname from profiles where user_id = ?', [userId]);
    if (existing) {
      if (existing === name) return;
      throw new BackendError('Nickname already claimed', '22023');
    }
    const taken = this.store.scalar<string>('select nickname from profiles where lower(nickname) = lower(?)', [name]);
    if (taken) throw new BackendError('Nickname taken', '23505');
    this.store.run('insert into profiles(user_id, nickname) values(?, ?)', [userId, name]);
  }

  async submitScore(userId: string, params: { score: number; level: number; durationMs: number; runId: string }) {
    try {
      this.store.transaction(() => {
        const { score, level, durationMs, runId } = params;
        if (!Number.isFinite(score) || !Number.isFinite(level) || !Number.isFinite(durationMs) || !runId
          || level < 1 || level > MAX_SAFE || score < 10 || score > MAX_SAFE
          || score % 10 !== 0 || score > 25000 * level
          || durationMs < 1000 || durationMs > MAX_SAFE) {
          throw new BackendError('Implausible score, level or active duration', '22023');
        }
        const speed = 1 + (level - 1) / 99;
        const minDuration = Math.max(1000, Math.ceil(score / speed), Math.ceil((level - 1) * 8000 / speed));
        if (durationMs < minDuration) throw new BackendError('Implausible score, level or active duration', '22023');
        if (!this.store.scalar('select 1 from profiles where user_id = ?', [userId])) {
          throw new BackendError('Claim a nickname first', '23503');
        }
        if (this.store.scalar('select 1 from score_submissions where user_id = ? and run_id = ?', [userId, runId])) {
          return;
        }
        const minuteAgo = new Date(Date.now() - 60_000).toISOString();
        const recent = this.store.scalar<number>(
          'select count(*) from score_submissions where user_id = ? and submitted_at > ?',
          [userId, minuteAgo],
        ) ?? 0;
        if (recent >= 5) throw new BackendError('Submission rate exceeded; retry later', 'P0001');
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        this.store.run('delete from score_submissions where user_id = ? and submitted_at < ?', [userId, cutoff]);
        const stamp = nowIso();
        this.store.run('insert into score_submissions(user_id, run_id, submitted_at) values(?,?,?)', [userId, runId, stamp]);
        const current = this.store.one<{ best_score: number; level_reached: number }>(
          'select best_score, level_reached from scores where user_id = ?', [userId],
        );
        if (!current) {
          this.store.run(
            'insert into scores(user_id, best_score, level_reached, updated_at) values(?,?,?,?)',
            [userId, score, level, stamp],
          );
        } else if (score > current.best_score || (score === current.best_score && level > current.level_reached)) {
          this.store.run(
            'update scores set best_score = ?, level_reached = ?, updated_at = ? where user_id = ?',
            [score, level, stamp, userId],
          );
        }
      });
      return { error: null };
    } catch (error) {
      if (error instanceof BackendError) return { error };
      return { error: new BackendError(String(error), 'P0001') };
    }
  }

  async submitAchievementEvents(userId: string, events: AchievementEvent[]) {
    try {
      const awards: string[] = [];
      this.store.transaction(() => {
        if (!this.store.scalar('select 1 from profiles where user_id = ?', [userId])) {
          throw new BackendError('Profile required', '28000');
        }
        if (!Array.isArray(events) || events.length < 1 || events.length > 32) {
          throw new BackendError('Invalid event batch', '22023');
        }
        const minuteAgo = new Date(Date.now() - 60_000).toISOString();
        const recent = this.store.scalar<number>(
          'select count(*) from achievement_events where user_id = ? and received_at > ?',
          [userId, minuteAgo],
        ) ?? 0;
        if (recent >= 1000) throw new BackendError('Achievement event rate exceeded', 'P0001');

        for (const item of events) {
          const runId = item.runId;
          const seq = item.sequence;
          const kind = item.kind;
          const level = item.level;
          const elapsed = item.elapsedMs;
          const peak = item.peak;
          const balance = item.balance;
          const deaths = item.deaths;
          const cleared = item.cleared;
          const penalty = item.penalty;
          const power = item.powerId;
          const ghost = item.ghostId;

          if (!runId || seq == null || seq < 1 || seq > MAX_SAFE
            || !kind || !KINDS.has(kind)
            || level == null || level < 1 || level > MAX_SAFE
            || elapsed == null || elapsed < 0 || elapsed > MAX_SAFE
            || peak == null || peak < 0 || peak > MAX_SAFE || peak > 25000 * level
            || balance == null || balance < 0 || balance > peak
            || deaths == null || deaths < 0 || deaths > MAX_SAFE
            || cleared == null || cleared < 0 || cleared > MAX_SAFE
            || penalty == null || penalty < 0 || penalty > MAX_SAFE
            || power == null || power < 0 || power > MAX_SAFE) {
            throw new BackendError('Invalid achievement event', '22023');
          }

          this.store.run('insert or ignore into achievement_runs(user_id, run_id) values(?, ?)', [userId, runId]);
          const run = this.store.one<RunState>(
            'select * from achievement_runs where user_id = ? and run_id = ?', [userId, runId],
          );
          if (!run) throw new BackendError('Invalid achievement event', '22023');

          if (seq <= run.last_sequence) {
            const prior = this.store.scalar<string>(
              'select payload from achievement_events where user_id = ? and run_id = ? and sequence = ?',
              [userId, runId, seq],
            );
            if (prior && prior === JSON.stringify(item)) continue;
            throw new BackendError('Conflicting event sequence', '22023');
          }

          const levelOk = level === cleared + 1 || (kind === 'clear' && level === cleared);
          if (run.ended || seq !== run.last_sequence + 1 || elapsed < run.elapsed_ms
            || peak < run.peak || cleared < run.cleared || deaths < run.deaths
            || power < run.power_id || !levelOk
            || (kind !== 'clear' && cleared !== run.cleared)
            || (kind === 'clear' && cleared !== run.cleared + 1)
            || (kind !== 'death' && deaths !== run.deaths)
            || (kind === 'death' && deaths !== run.deaths + 1)) {
            throw new BackendError('Out-of-order achievement event', '22023');
          }

          let screenDeaths = run.screen_deaths;
          let tunnelCount = run.tunnel_count;
          let powerStarted = run.power_started_ms;
          let captures = run.captures;
          let ended = run.ended;
          let powerId = run.power_id;

          if (kind === 'power') {
            if (power !== run.power_id + 1) throw new BackendError('Invalid power window', '22023');
            captures = 0;
            powerStarted = elapsed;
            powerId = power;
          } else if (power !== run.power_id) {
            throw new BackendError('Invalid power window', '22023');
          } else {
            powerId = power;
          }

          if (kind === 'capture') {
            if (power === 0 || ghost == null || ghost < 0 || ghost > 3 || elapsed > powerStarted + 14000) {
              throw new BackendError('Invalid capture', '22023');
            }
            captures += 1;
            for (const slug of ['phantom_quartet', 'phantom_quintuplets', 'phantom_sextuplets', 'phantom_septuplets', 'phantom_octuplets']) {
              if (captures >= (achievementThreshold(slug).captures ?? Number.MAX_SAFE_INTEGER) && this.award(userId, slug)) awards.push(slug);
            }
          } else if (kind === 'death') {
            const maxPenalty = Math.min(MAX_SAFE, 10 * 2 ** Math.min(deaths - 1, 50));
            if (penalty > peak || balance + penalty > peak || penalty > maxPenalty) {
              throw new BackendError('Invalid penalty', '22023');
            }
            screenDeaths += 1;
            if (penalty > (achievementThreshold('still_standing').penaltyGreaterThan ?? 100000) && this.award(userId, 'still_standing')) awards.push('still_standing');
          } else if (kind === 'clear') {
            if (elapsed < cleared * 8000) throw new BackendError('Implausible clear duration', '22023');
            if (screenDeaths === (achievementThreshold('ace_spirit').screenDeaths ?? 0) && this.award(userId, 'ace_spirit')) awards.push('ace_spirit');
            screenDeaths = 0;
            if (deaths === 0) {
              for (const slug of ['amazind_circuit', 'first_light', 'perfect_circuit', 'ominius_circuit', 'light_bringer']) {
                const threshold = achievementThreshold(slug);
                if (cleared >= (threshold.cleared ?? Number.MAX_SAFE_INTEGER) && deaths === (threshold.deaths ?? 0) && this.award(userId, slug)) awards.push(slug);
              }
            }
            if (cleared >= (achievementThreshold('neon_pioneer').cleared ?? Number.MAX_SAFE_INTEGER) && this.award(userId, 'neon_pioneer')) awards.push('neon_pioneer');
          } else if (kind === 'tunnel') {
            tunnelCount += 1;
            if (tunnelCount >= (achievementThreshold('tunnel_loop').tunnels ?? Number.MAX_SAFE_INTEGER) && this.award(userId, 'tunnel_loop')) awards.push('tunnel_loop');
          } else if (kind === 'over') {
            if (balance !== 0 || deaths === 0) throw new BackendError('Invalid game over', '22023');
            ended = 1;
            if (run.cleared === 0) {
              this.store.run('insert or ignore into noob_runs(user_id, run_id) values(?, ?)', [userId, runId]);
              const noobs = this.store.scalar<number>('select count(*) from noob_runs where user_id = ?', [userId]) ?? 0;
              if (noobs >= (achievementThreshold('noob').gameOvers ?? Number.MAX_SAFE_INTEGER) && this.award(userId, 'noob')) awards.push('noob');
            }
          }

          const starter = achievementThreshold('spark_starter');
          if (peak >= (starter.peak ?? Number.MAX_SAFE_INTEGER) && deaths === (starter.deaths ?? 0) && this.award(userId, 'spark_starter')) awards.push('spark_starter');
          if (peak >= (achievementThreshold('spark_keeper').peak ?? Number.MAX_SAFE_INTEGER) && this.award(userId, 'spark_keeper')) awards.push('spark_keeper');

          this.store.run(
            `update achievement_runs set last_sequence=?, elapsed_ms=?, cleared=?, deaths=?, screen_deaths=?,
              peak=?, tunnel_count=?, power_id=?, power_started_ms=?, captures=?, ended=?
             where user_id=? and run_id=?`,
            [seq, elapsed, cleared, deaths, screenDeaths, peak, tunnelCount, powerId, powerStarted, captures, ended, userId, runId],
          );
          this.store.run(
            'insert into achievement_events(user_id, run_id, sequence, kind, payload, received_at) values(?,?,?,?,?,?)',
            [userId, runId, seq, kind, JSON.stringify(item), nowIso()],
          );
        }
      });
      return { data: awards, error: null };
    } catch (error) {
      if (error instanceof BackendError) return { data: null, error };
      return { data: null, error: new BackendError(String(error), 'P0001') };
    }
  }

  async ranking(): Promise<RankingRow[]> {
    this.captureDailyLeader(utcDay());
    return this.store.all<RankingRow>(
      `select s.user_id as user_id, p.nickname as nickname, s.best_score as best_score, s.level_reached as level_reached
       from scores s join profiles p on p.user_id = s.user_id
       order by s.best_score desc, s.updated_at asc, s.user_id asc limit 20`,
    );
  }

  async profile(userId: string): Promise<Omit<AchievementProfile, 'cached' | 'available'>> {
    this.captureDailyLeader(utcDay());
    const definitions = this.store.all<{ slug: string; family_key: string; tier: number; badge_key: string; exclusive: number }>(
      'select slug, family_key, tier, badge_key, exclusive from achievement_definitions where active = 1 order by sort_order',
    );
    const common = this.store.all<{ slug: string; user_id: string; awarded_at: string }>(
      'select slug, user_id, awarded_at from player_achievements where user_id = ?', [userId],
    );
    const exclusive = this.store.all<{ slug: string; user_id: string; awarded_at: string; nickname: string }>(
      `select e.slug as slug, e.user_id as user_id, e.awarded_at as awarded_at, p.nickname as nickname
       from exclusive_holders e join profiles p on p.user_id = e.user_id`,
    );
    const score = this.store.one<{ best_score: number; level_reached: number }>(
      'select best_score, level_reached from scores where user_id = ?', [userId],
    );
    const candidates = this.store.all<{ slug: string; queue_position: number }>(
      `select ranked.slug as slug, ranked.queue_position as queue_position from (
         select c.slug as slug, c.user_id as user_id,
           row_number() over(partition by c.slug order by c.candidate_id) as queue_position
         from achievement_candidates c
       ) ranked where ranked.user_id = ?`,
      [userId],
    );
    return {
      definitions: definitions.map(row => ({ ...row, exclusive: Boolean(row.exclusive) })),
      awards: [
        ...common,
        ...exclusive.map(row => ({ slug: row.slug, user_id: row.user_id, awarded_at: row.awarded_at, nickname: row.nickname })),
      ],
      candidates,
      bestScore: Number(score?.best_score ?? 0),
      levelReached: Number(score?.level_reached ?? 0),
    };
  }

  private award(userId: string, slug: string): boolean {
    const def = this.store.one<{ exclusive: number }>('select exclusive from achievement_definitions where slug = ? and active = 1', [slug]);
    if (!def) return false;
    const stamp = nowIso();
    if (def.exclusive) {
      this.store.run(
        'insert or ignore into achievement_candidates(slug, user_id, qualified_at) values(?,?,?)',
        [slug, userId, stamp],
      );
      const before = this.store.scalar('select user_id from exclusive_holders where slug = ?', [slug]);
      if (before) return false;
      this.store.run('insert into exclusive_holders(slug, user_id, awarded_at) values(?,?,?)', [slug, userId, stamp]);
      return true;
    }
    const before = this.store.scalar('select 1 from player_achievements where user_id = ? and slug = ?', [userId, slug]);
    if (before) return false;
    this.store.run('insert into player_achievements(user_id, slug, awarded_at) values(?,?,?)', [userId, slug, stamp]);
    return true;
  }

  /** Local stand-in for the production cron: snapshot today's UTC leader when ranking/profile is read. */
  captureDailyLeader(day: string) {
    const today = utcDay();
    if (day > today) return;
    const existing = this.store.scalar('select 1 from leaderboard_daily_leaders where day_utc = ?', [day]);
    if (existing) return;
    const leader = this.store.one<{ user_id: string; best_score: number }>(
      'select user_id, best_score from scores order by best_score desc, updated_at asc, user_id asc limit 1',
    );
    if (!leader) return;
    this.store.run(
      'insert or ignore into leaderboard_daily_leaders(day_utc, user_id, score, captured_at) values(?,?,?,?)',
      [day, leader.user_id, leader.best_score, nowIso()],
    );
    const start = new Date(`${day}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 29);
    const startDay = start.toISOString().slice(0, 10);
    const streak = this.store.scalar<number>(
      'select count(*) from leaderboard_daily_leaders where day_utc between ? and ? and user_id = ?',
      [startDay, day, leader.user_id],
    ) ?? 0;
    if (streak === 30) this.award(leader.user_id, 'neon_maze_king');
  }
}
