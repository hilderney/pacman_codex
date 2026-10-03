import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, type AuthAdapter, type DataAdapter } from '../src/services/backend/types';
import { Network, queueAchievement, queueRun, type PendingRun } from '../src/services/network';
import { read, safeStorage } from '../src/services/storage';

const result = { score: 100, level: 1, durationMs: 5000, runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const submitScore = vi.fn();
const submitAchievementEvents = vi.fn();
let network: Network;

function adapters(): { auth: AuthAdapter; data: DataAdapter } {
  return {
    auth: {
      kind: 'local', available: true,
      init: async () => {}, getSession: () => ({ user: { id: 'network-user' } }),
      onAuthStateChange: () => () => {}, signInWithGoogle: async () => {}, signOut: async () => {},
    },
    data: {
      kind: 'local', ready: true,
      init: async () => {}, getNickname: async () => 'Player', claimNickname: async () => {},
      submitScore, submitAchievementEvents, ranking: async () => [],
      profile: async () => ({ definitions: [], awards: [], candidates: [], bestScore: 0, levelReached: 0 }),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  const { auth, data } = adapters();
  network = new Network(auth, data);
  network.session = { user: { id: 'network-user' } };
  network.nickname = 'Player';
  safeStorage.removeItem('neon:pending:network-user');
  safeStorage.removeItem('neon:pending:other-user');
  safeStorage.removeItem('neon:achievement-events:network-user');
  submitScore.mockReset();
  submitAchievementEvents.mockReset();
  submitScore.mockResolvedValue({ error: null });
  submitAchievementEvents.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('score synchronization', () => {
  it('does no RPC for a guest result', async () => {
    queueRun(null, result); await network.flush(); expect(submitScore).not.toHaveBeenCalled();
  });
  it('keeps an offline run, then submits it under the same identity', async () => {
    vi.stubGlobal('navigator', { onLine: false }); queueRun('network-user', result);
    expect(await network.flush()).toBe('pending'); expect(submitScore).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true }); expect(await network.flush()).toBe('synced');
    expect(submitScore).toHaveBeenCalledWith('network-user', {
      score: 100, level: 1, durationMs: 5000, runId: expect.any(String),
    });
    expect(read('pending:network-user', null)).toBeNull();
  });
  it('does not send a different account’s pending score', async () => {
    queueRun('other-user', result); expect(await network.flush()).toBe('none'); expect(submitScore).not.toHaveBeenCalled();
    expect(read('pending:other-user', null)).not.toBeNull();
  });
  it('preserves retryable failures and does not retry permanently rejected runs', async () => {
    queueRun('network-user', result);
    submitScore.mockResolvedValueOnce({ error: new BackendError('rate', 'P0001') });
    expect(await network.flush()).toBe('pending'); expect(read('pending:network-user', null)).not.toBeNull();
    submitScore.mockResolvedValueOnce({ error: new BackendError('bad', '22023') });
    expect(await network.flush()).toBe('rejected'); expect(read('pending:network-user', null)).toBeNull();
  });
  it('coalesces simultaneous flushes and retains a better run queued in flight', async () => {
    queueRun('network-user', result);
    let resolve!: (value: { error: null }) => void;
    const started = new Promise<void>(ready => {
      submitScore.mockImplementationOnce(() => new Promise(r => { resolve = r; ready(); }));
    });
    const first = network.flush(), second = network.flush(); expect(first).toBe(second);
    await started;
    queueRun('network-user', { ...result, score: 200, runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    resolve({ error: null }); await first;
    expect(read<PendingRun | null>('pending:network-user', null)?.score).toBe(200);
    expect(submitScore).toHaveBeenCalledOnce();
  });
  it('handles a rejected fetch without breaking the caller', async () => {
    queueRun('network-user', result); submitScore.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await network.flush()).toBe('pending'); expect(read('pending:network-user', null)).not.toBeNull();
  });
  it('gives each improved checkpoint of the same run its own submission receipt', async () => {
    queueRun('network-user', result); await network.flush();
    queueRun('network-user', { ...result, score: 200, durationMs: 20000 }); await network.flush();
    const ids = submitScore.mock.calls.map(call => call[1].runId);
    expect(ids).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]);
  });
  it('announces one completed synchronization after both queues finish', async () => {
    const completed = vi.fn(); network.onSyncComplete = completed;
    queueRun('network-user', result);
    await network.flushPending();
    expect(completed).toHaveBeenCalledOnce();
    await network.flushPending();
    expect(completed).toHaveBeenCalledOnce();
  });
  it('keeps ordered achievement events offline and announces only server-confirmed awards', async () => {
    const runId = crypto.randomUUID();
    const item = { runId, sequence: 1, kind: 'clear' as const, level: 1, elapsedMs: 10000,
      peak: 100, balance: 100, deaths: 0, cleared: 1, penalty: 0, powerId: 0, ghostId: null };
    const notify = vi.fn(); network.onAchievements = notify;
    vi.stubGlobal('navigator', { onLine: false }); queueAchievement('network-user', item);
    await network.flushAchievements(); expect(submitAchievementEvents).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    submitAchievementEvents.mockResolvedValueOnce({ data: ['ace_spirit'], error: null });
    await network.flushAchievements();
    expect(submitAchievementEvents).toHaveBeenCalledWith('network-user', [item]);
    expect(notify).toHaveBeenCalledWith(['ace_spirit']); expect(network.pendingAchievements()).toBe(0);
  });
});
