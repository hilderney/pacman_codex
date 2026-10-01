import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Network, queueRun, type PendingRun } from '../src/services/network';
import { read, safeStorage } from '../src/services/storage';

const result = { score: 100, level: 1, durationMs: 5000, runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const rpc = vi.fn();
let network: Network;
beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  network = new Network(); network.client = { rpc } as unknown as SupabaseClient;
  network.session = { user: { id: 'network-user' } } as Session; network.nickname = 'Player';
  safeStorage.removeItem('neon:pending:network-user'); safeStorage.removeItem('neon:pending:other-user');
  rpc.mockReset(); rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());
describe('score synchronization', () => {
  it('does no RPC for a guest result', async () => {
    queueRun(null, result); await network.flush(); expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps an offline run, then submits it under the same identity', async () => {
    vi.stubGlobal('navigator', { onLine: false }); queueRun('network-user', result);
    expect(await network.flush()).toBe('pending'); expect(rpc).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true }); expect(await network.flush()).toBe('synced');
    expect(rpc).toHaveBeenCalledWith('submit_score', { p_score: 100, p_level: 1, p_duration_ms: 5000, p_run_id: result.runId });
    expect(read('pending:network-user', null)).toBeNull();
  });
  it('does not send a different account’s pending score', async () => {
    queueRun('other-user', result); expect(await network.flush()).toBe('none'); expect(rpc).not.toHaveBeenCalled();
    expect(read('pending:other-user', null)).not.toBeNull();
  });
  it('preserves retryable failures and does not retry permanently rejected runs', async () => {
    queueRun('network-user', result); rpc.mockResolvedValueOnce({ error: { code: 'P0001' } });
    expect(await network.flush()).toBe('pending'); expect(read('pending:network-user', null)).not.toBeNull();
    rpc.mockResolvedValueOnce({ error: { code: '22023' } });
    expect(await network.flush()).toBe('rejected'); expect(read('pending:network-user', null)).toBeNull();
  });
  it('coalesces simultaneous flushes and retains a better run queued in flight', async () => {
    queueRun('network-user', result);
    let resolve!: (value: { error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const first = network.flush(), second = network.flush(); expect(first).toBe(second);
    queueRun('network-user', { ...result, score: 200, runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    resolve({ error: null }); await first;
    expect(read<PendingRun | null>('pending:network-user', null)?.score).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('handles a rejected fetch without breaking the caller', async () => {
    queueRun('network-user', result); rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await network.flush()).toBe('pending'); expect(read('pending:network-user', null)).not.toBeNull();
  });
});
