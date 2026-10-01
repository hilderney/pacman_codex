import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestScore, defaults, loadSettings, read, safeStorage, saveBest, write } from '../src/services/storage';
import { queueRun } from '../src/services/network';

afterEach(() => vi.unstubAllGlobals());
describe('local persistence and privacy', () => {
  it('survives disabled storage and corrupt JSON', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() {} });
    write('example', 123); expect(read('example', 0)).toBe(123);
    safeStorage.setItem('neon:settings', '{bad-json'); expect(loadSettings()).toEqual(defaults());
    saveBest(100); saveBest(50); expect(bestScore()).toBe(100);
  });
  it('rejects malformed bindings and clamps volume', () => {
    write('settings', { volume: 10, muted: true, keys: { up: ['<script>', 'KeyW'] } });
    const result = loadSettings(); expect(result.volume).toBe(1); expect(result.muted).toBe(true); expect(result.keys).toEqual(defaults().keys);
  });
  it('never queues a guest run and keeps each account separate', () => {
    const run = { score: 200, level: 1, durationMs: 30000, runId: 'one' };
    queueRun(null, run); expect(read('pending:null', null)).toBeNull();
    queueRun('alice', run); queueRun('bob', { ...run, score: 500 }); queueRun('alice', { ...run, score: 100 });
    expect(read<{ score: number }>('pending:alice', { score: 0 }).score).toBe(200);
    expect(read<{ score: number }>('pending:bob', { score: 0 }).score).toBe(500);
  });
});
