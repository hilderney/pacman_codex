import { beforeAll, describe, expect, it } from 'vitest';
import type { AchievementEvent, AchievementKind } from '../src/game/engine';
import { MOCK_ACCOUNTS, MockGoogleAuth } from '../src/services/backend/mockAuth';
import { SqliteData } from '../src/services/backend/sqliteData';

const alice = MOCK_ACCOUNTS[0].id;
const bob = MOCK_ACCOUNTS[1].id;
const carol = MOCK_ACCOUNTS[2].id;

const event = (runId: string, sequence: number, kind: AchievementKind, changes: Partial<AchievementEvent> = {}): AchievementEvent => ({
  runId, sequence, kind, level: 1, elapsedMs: sequence * 10000, peak: 100,
  balance: 100, deaths: 0, cleared: 0, penalty: 0, powerId: 0, ghostId: null, ...changes,
});

describe('local SQLite + mock Google adapters', () => {
  const data = new SqliteData();
  const auth = new MockGoogleAuth();

  beforeAll(async () => {
    await data.init();
    await auth.init();
    await data.claimNickname(alice, 'Alice');
    await data.claimNickname(bob, 'Bob');
  }, 60000);

  it('signs in a mock Google account without OAuth redirect', async () => {
    await auth.signInWithGoogle(alice);
    expect(auth.getSession()?.user.id).toBe(alice);
    expect(auth.getSession()?.user.email).toContain('alice');
    await auth.signOut();
    expect(auth.getSession()).toBeNull();
  });

  it('rejects duplicate nicknames case-insensitively', async () => {
    await expect(data.claimNickname(carol, 'alice')).rejects.toMatchObject({ code: '23505' });
  });

  it('stores the best score and returns a ranking row', async () => {
    const { error } = await data.submitScore(alice, {
      score: 100, level: 1, durationMs: 5000, runId: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    const rows = await data.ranking();
    expect(rows[0]).toMatchObject({ user_id: alice, nickname: 'Alice', best_score: 100 });
  });

  it('awards Ace Spirit through the TypeScript RPC port', async () => {
    const run = crypto.randomUUID();
    const { data: awards, error } = await data.submitAchievementEvents(alice, [
      event(run, 1, 'clear', { cleared: 1 }),
    ]);
    expect(error).toBeNull();
    expect(awards).toContain('ace_spirit');
  });

  it('awards Phantom tiers within one power window', async () => {
    const run = crypto.randomUUID();
    const entries = [event(run, 1, 'power', { powerId: 1, elapsedMs: 1000 })];
    for (let i = 0; i < 8; i++) {
      entries.push(event(run, i + 2, 'capture', {
        powerId: 1, ghostId: i % 4, elapsedMs: 1500 + i * 1000,
      }));
    }
    const { data: awards, error } = await data.submitAchievementEvents(bob, entries);
    expect(error).toBeNull();
    expect(awards?.filter(slug => slug.startsWith('phantom_'))).toEqual([
      'phantom_quartet', 'phantom_quintuplets', 'phantom_sextuplets', 'phantom_septuplets', 'phantom_octuplets',
    ]);
  });

  it('assigns exclusive firsts to the earliest qualifier', async () => {
    const runAlice = crypto.randomUUID();
    for (let start = 1; start <= 50; start += 25) {
      const batch = Array.from({ length: Math.min(25, 51 - start) }, (_, index) => {
        const cleared = start + index;
        return event(runAlice, cleared, 'clear', { level: cleared, cleared, elapsedMs: cleared * 10000 });
      });
      const { error } = await data.submitAchievementEvents(alice, batch);
      expect(error).toBeNull();
    }
    const profile = await data.profile(alice);
    expect(profile.awards.some(row => row.slug === 'first_light' && row.user_id === alice)).toBe(true);
    expect(profile.awards.some(row => row.slug === 'neon_pioneer' && row.user_id === alice)).toBe(true);

    const runBob = crypto.randomUUID();
    for (let start = 1; start <= 50; start += 25) {
      const batch = Array.from({ length: Math.min(25, 51 - start) }, (_, index) => {
        const cleared = start + index;
        return event(runBob, cleared, 'clear', { level: cleared, cleared, elapsedMs: cleared * 10000 });
      });
      await data.submitAchievementEvents(bob, batch);
    }
    const bobProfile = await data.profile(bob);
    expect(bobProfile.awards.some(row => row.slug === 'first_light' && row.user_id === bob)).toBe(false);
    expect(bobProfile.candidates.some(row => row.slug === 'first_light')).toBe(true);
  });
});
