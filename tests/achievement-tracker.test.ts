import { describe, expect, it } from 'vitest';
import { achievementThreshold } from '../src/achievements/config';
import { AchievementTracker } from '../src/achievements/tracker';
import type { AchievementEvent, AchievementKind } from '../src/game/engine';

const event = (runId: string, sequence: number, kind: AchievementKind, changes: Partial<AchievementEvent> = {}): AchievementEvent => ({
  runId, sequence, kind, level: 1, elapsedMs: sequence * 10000, peak: 100,
  balance: 100, deaths: 0, cleared: 0, penalty: 0, powerId: 0, ghostId: null, ...changes,
});

describe('immediate achievement feedback', () => {
  it('unlocks run achievements at the exact event and never repeats them', () => {
    const tracker = new AchievementTracker(), run = crypto.randomUUID();
    const sparkPeak = achievementThreshold('spark_starter').peak ?? 500000;
    expect(tracker.consume(event(run, 1, 'clear', { cleared: 1 }))).toEqual(['ace_spirit']);
    expect(tracker.consume(event(run, 2, 'clear', { level: 2, cleared: 2 }))).toEqual([]);
    expect(tracker.consume(event(run, 3, 'peak', { level: 3, cleared: 2, peak: sparkPeak, balance: sparkPeak }))).toEqual(['spark_starter']);
  });

  it('unlocks all Phantom tiers in one energy window', () => {
    const tracker = new AchievementTracker(), run = crypto.randomUUID(), found: string[] = [];
    tracker.consume(event(run, 1, 'power', { powerId: 1 }));
    for (let i = 0; i < 8; i++) found.push(...tracker.consume(event(run, i + 2, 'capture', { powerId: 1, ghostId: i % 4 })));
    expect(found).toEqual(['phantom_quartet', 'phantom_quintuplets', 'phantom_sextuplets', 'phantom_septuplets', 'phantom_octuplets']);
  });

  it('persists three distinct first-screen game overs for Noob', () => {
    let tracker = new AchievementTracker();
    for (let i = 0; i < 2; i++) tracker.consume(event(crypto.randomUUID(), 1, 'over', { deaths: 1, balance: 0 }));
    tracker = new AchievementTracker(tracker.snapshot());
    expect(tracker.consume(event(crypto.randomUUID(), 1, 'over', { deaths: 1, balance: 0 }))).toContain('noob');
  });
});
