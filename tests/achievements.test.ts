import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AchievementEvent, AchievementKind } from '../src/game/engine';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const asUser = (id: string, role = 'authenticated') => db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`);
const event = (runId: string, sequence: number, kind: AchievementKind, changes: Partial<AchievementEvent> = {}): AchievementEvent => ({
  runId, sequence, kind, level: 1, elapsedMs: sequence * 10000, peak: 100,
  balance: 100, deaths: 0, cleared: 0, penalty: 0, powerId: 0, ghostId: null, ...changes,
});
const send = async (events: AchievementEvent[]) => {
  const result = await db.query<{ awards: string[] }>('select public.submit_achievement_events($1::jsonb) as awards', [JSON.stringify(events)]);
  return result.rows[0].awards;
};

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values ('${alice}'),('${bob}');`);
  for (const migration of ['001_neon_maze.sql', '002_endless_runs.sql', '003_achievements.sql'])
    await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  await asUser(alice); await db.query("select public.claim_nickname('Alice')");
  await asUser(bob); await db.query("select public.claim_nickname('Bob')");
}, 60000);
afterAll(async () => { await db.close(); });

describe.sequential('achievement awards', () => {
  it('seeds 18 definitions and rejects client writes and anonymous events', async () => {
    await asUser('', 'anon');
    const rows = await db.query('select slug from public.achievement_definitions');
    expect(rows.rows).toHaveLength(18);
    await expect(db.exec(`insert into public.player_achievements values('${alice}','ace_spirit',now())`)).rejects.toThrow(/permission denied/);
    await expect(send([event(crypto.randomUUID(), 1, 'clear', { cleared: 1 })])).rejects.toThrow(/permission denied/);
  });
  it('awards Ace Spirit once and rejects skipped or conflicting event sequence', async () => {
    await asUser(alice);
    const run = crypto.randomUUID();
    const clear = event(run, 1, 'clear', { cleared: 1 });
    expect(await send([clear])).toContain('ace_spirit');
    expect(await send([clear])).toEqual([]);
    await expect(send([event(run, 1, 'death', { deaths: 1, balance: 90, penalty: 10 })])).rejects.toThrow(/Conflicting/);
    await expect(send([event(run, 3, 'clear', { level: 2, cleared: 2 })])).rejects.toThrow(/Out-of-order/);
    await expect(send([event(run, 2, 'clear', { level: 2, cleared: 2, elapsedMs: 11000 })])).rejects.toThrow(/Implausible clear duration/);
  });
  it('counts three distinct screen-one game overs for Noob', async () => {
    await asUser(alice);
    for (let i = 0; i < 3; i++) {
      const run = crypto.randomUUID();
      const awards = await send([
        event(run, 1, 'death', { deaths: 1, balance: 0, peak: 10, penalty: 10 }),
        event(run, 2, 'over', { deaths: 1, balance: 0, peak: 10 }),
      ]);
      expect(awards.includes('noob')).toBe(i === 2);
    }
  });
  it('awards the Phantom tiers only within one power window', async () => {
    await asUser(bob);
    const run = crypto.randomUUID();
    const entries = [event(run, 1, 'power', { powerId: 1, elapsedMs: 1000 })];
    for (let i = 0; i < 8; i++) entries.push(event(run, i + 2, 'capture', {
      powerId: 1, ghostId: i % 4, elapsedMs: 1500 + i * 1000,
    }));
    const awards = await send(entries);
    expect(awards.filter(slug => slug.startsWith('phantom_'))).toEqual([
      'phantom_quartet','phantom_quintuplets','phantom_sextuplets','phantom_septuplets','phantom_octuplets',
    ]);
    await expect(send([event(run, 10, 'capture', { powerId: 1, ghostId: 0, elapsedMs: 16000 })])).rejects.toThrow(/Invalid capture/);
  });
  it('assigns exclusive firsts atomically and transfers them after deleting the holder', async () => {
    const runAlice = crypto.randomUUID(), runBob = crypto.randomUUID();
    for (const [user, run] of [[alice, runAlice], [bob, runBob]] as const) {
      await asUser(user);
      for (let start = 1; start <= 50; start += 25) {
        const batch = Array.from({ length: Math.min(25, 51 - start) }, (_, index) => {
          const cleared = start + index;
          return event(run, cleared, 'clear', { level: cleared, cleared, elapsedMs: cleared * 10000 });
        });
        await send(batch);
      }
    }
    await asUser('', 'anon');
    const holders = await db.query<{ slug: string; user_id: string }>("select slug,user_id from public.exclusive_holders where slug in ('first_light','neon_pioneer') order by slug");
    expect(holders.rows).toEqual([{ slug: 'first_light', user_id: alice }, { slug: 'neon_pioneer', user_id: alice }]);
    await db.exec(`reset role; delete from auth.users where id='${alice}'`);
    const transferred = await db.query<{ slug: string; user_id: string }>("select slug,user_id from public.exclusive_holders where slug in ('first_light','neon_pioneer') order by slug");
    expect(transferred.rows).toEqual([{ slug: 'first_light', user_id: bob }, { slug: 'neon_pioneer', user_id: bob }]);
  });
  it('awards all Circuit tiers and the exclusive 500-screen Light Bringer', async () => {
    await asUser(bob);
    const run = crypto.randomUUID();
    const awards: string[] = [];
    for (let start = 1; start <= 500; start += 25) {
      const batch = Array.from({ length: Math.min(25, 501 - start) }, (_, index) => {
        const cleared = start + index;
        return event(run, cleared, 'clear', { level: cleared, cleared, elapsedMs: cleared * 10000 });
      });
      awards.push(...await send(batch));
    }
    expect(awards).toEqual(expect.arrayContaining(['perfect_circuit','ominius_circuit','light_bringer']));
    const holder = await db.query<{ user_id: string }>("select user_id from public.exclusive_holders where slug='light_bringer'");
    expect(holder.rows[0].user_id).toBe(bob);
  });
  it('awards King after exactly 30 distinct UTC leader snapshots', async () => {
    await asUser(bob);
    await db.query('select public.submit_score(100,1,10000,$1::uuid)', [crypto.randomUUID()]);
    await db.exec(`reset role;
      insert into private.leaderboard_daily_leaders(day_utc,user_id,score)
      select (current_date-n)::date,'${bob}'::uuid,100 from generate_series(1,29) as n;
      select private.capture_daily_leader(current_date);`);
    const award = await db.query<{ slug: string }>(`select slug from public.player_achievements where user_id='${bob}' and slug='neon_maze_king'`);
    expect(award.rows).toEqual([{ slug: 'neon_maze_king' }]);
  });
  it('uses peak, effective death loss and 101 actual tunnel events', async () => {
    await asUser(bob);
    const run = crypto.randomUUID();
    expect(await send([event(run, 1, 'peak', { peak: 1000, balance: 1000 })])).toContain('spark_starter');
    for (let i = 1; i <= 8; i++) await send([event(run, i + 1, 'clear', {
      level: i, cleared: i, peak: 1000, balance: 1000,
    })]);
    expect(await send([event(run, 10, 'peak', { level: 9, cleared: 8, peak: 200000, balance: 200000 })])).toContain('spark_keeper');
    for (let death = 1; death <= 15; death++) {
      const penalty = 10 * 2 ** (death - 1);
      const awards = await send([event(run, 10 + death, 'death', {
        level: 9, cleared: 8, deaths: death, peak: 200000,
        balance: 200000 - penalty, penalty,
      })]);
      expect(awards.includes('still_standing')).toBe(death === 15);
    }
    for (let start = 26; start <= 126; start += 25) {
      const batch = Array.from({ length: Math.min(25, 127 - start) }, (_, index) =>
        event(run, start + index, 'tunnel', { level: 9, cleared: 8, deaths: 15, peak: 200000,
          balance: 36160, penalty: 163840 }));
      const awards = await send(batch);
      expect(awards.includes('tunnel_loop')).toBe(start === 126);
    }
  });
});
