import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A real embedded PostgreSQL engine exercises the production migration.
// Only Supabase's auth schema/roles/JWT helper are emulated here.
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';
const asUser = async (id: string, role = 'authenticated') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role ${role};`);
};
const submit = (score: number, level = 1, duration = 30000, run = crypto.randomUUID()) => db.query('select public.submit_score($1,$2,$3,$4) as best', [score, level, duration, run]);
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${alice}'),('${bob}');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/001_neon_maze.sql', import.meta.url), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
describe.sequential('database RLS and RPC', () => {
  it('denies anonymous writes and RPC use', async () => {
    await asUser('', 'anon');
    await expect(db.exec(`insert into public.profiles values('${alice}','Alice')`)).rejects.toThrow(/permission denied/);
    await expect(submit(100)).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.claim_nickname('Alice')")).rejects.toThrow(/permission denied/);
  });
  it('validates names, enforces case-insensitive uniqueness and immutable ownership', async () => {
    await asUser(alice);
    await expect(db.query("select public.claim_nickname('ab')")).rejects.toThrow(/Invalid nickname/);
    await db.query("select public.claim_nickname('Alice')");
    await expect(db.query("select public.claim_nickname('Someone')")).rejects.toThrow(/already claimed/);
    await asUser(bob);
    await expect(db.query("select public.claim_nickname('alice')")).rejects.toThrow(/duplicate key/);
    await db.query("select public.claim_nickname('Bob')");
  });
  it('denies direct authenticated writes even to the current player', async () => {
    await asUser(alice);
    await expect(db.exec(`insert into public.scores values('${alice}',999,1,now())`)).rejects.toThrow(/permission denied/);
    await expect(db.exec("update public.profiles set nickname = 'hacked'")).rejects.toThrow(/permission denied/);
    await expect(db.exec('delete from public.scores')).rejects.toThrow(/permission denied/);
    await expect(db.exec('select * from private.score_submissions')).rejects.toThrow(/permission denied/);
  });
  it('rejects implausible level, score, duration and null inputs', async () => {
    for (const params of [[26000, 1, 40000], [100, 0, 30000], [100, 1000, 30000], [1000, 1, 1], [-10, 1, 10000], [101, 1, 10000]])
      await expect(submit(params[0], params[1], params[2])).rejects.toThrow(/Implausible/);
    await expect(db.query('select public.submit_score(null,1,10000,null)')).rejects.toThrow(/Implausible/);
  });
  it('stores only the best run, associates its level, and deduplicates retries', async () => {
    const run = crypto.randomUUID();
    await submit(100, 1, 30000, run); await submit(100, 1, 30000, run);
    await submit(200, 2); await submit(50, 3);
    const result = await db.query<{ best_score: number; level_reached: number }>('select * from public.scores');
    expect(result.rows).toHaveLength(1); expect(result.rows[0].best_score).toBe(200); expect(result.rows[0].level_reached).toBe(2);
  });
  it('limits new submissions to five per rolling minute, separately per user', async () => {
    await submit(210); await submit(220);
    await expect(submit(230)).rejects.toThrow(/rate exceeded/);
    await asUser(bob); await submit(300);
    await asUser('', 'anon'); const result = await db.query<{ user_id: string }>('select * from public.scores order by best_score desc');
    expect(result.rows).toHaveLength(2); expect(result.rows[0].user_id).toBe(bob);
  });
});
