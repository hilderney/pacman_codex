import type { AchievementEvent } from '../game/engine';
import { achievementThreshold } from './config';

export interface LocalAchievementState { unlocked: string[]; noobRuns: string[] }

/** Mirrors the deterministic run rules so feedback can happen immediately.
 * Supabase remains the authority and verifies the queued events at run end. */
export class AchievementTracker {
  private unlocked: Set<string>;
  private noobRuns: Set<string>;
  private runId = '';
  private screenDeaths = 0;
  private tunnelCount = 0;
  private powerId = 0;
  private captures = 0;

  constructor(state: LocalAchievementState = { unlocked: [], noobRuns: [] }) {
    this.unlocked = new Set(state.unlocked);
    this.noobRuns = new Set(state.noobRuns);
  }

  consume(event: AchievementEvent): string[] {
    if (event.runId !== this.runId) {
      this.runId = event.runId; this.screenDeaths = 0; this.tunnelCount = 0;
      this.powerId = 0; this.captures = 0;
    }
    const candidates: string[] = [];
    if (event.kind === 'death') {
      this.screenDeaths++;
      const stillStanding = achievementThreshold('still_standing').penaltyGreaterThan ?? 100000;
      if (event.penalty > stillStanding) candidates.push('still_standing');
    } else if (event.kind === 'clear') {
      if (this.screenDeaths === (achievementThreshold('ace_spirit').screenDeaths ?? 0)) candidates.push('ace_spirit');
      this.screenDeaths = 0;
      if (event.deaths === 0) {
        for (const slug of ['amazind_circuit', 'first_light', 'perfect_circuit', 'ominius_circuit', 'light_bringer']) {
          const threshold = achievementThreshold(slug);
          if (event.cleared >= (threshold.cleared ?? Number.MAX_SAFE_INTEGER) && event.deaths === (threshold.deaths ?? 0)) candidates.push(slug);
        }
      }
      if (event.cleared >= (achievementThreshold('neon_pioneer').cleared ?? Number.MAX_SAFE_INTEGER)) candidates.push('neon_pioneer');
    } else if (event.kind === 'tunnel') {
      if (++this.tunnelCount >= (achievementThreshold('tunnel_loop').tunnels ?? Number.MAX_SAFE_INTEGER)) candidates.push('tunnel_loop');
    } else if (event.kind === 'power') {
      this.powerId = event.powerId; this.captures = 0;
    } else if (event.kind === 'capture') {
      if (event.powerId !== this.powerId) { this.powerId = event.powerId; this.captures = 0; }
      this.captures++;
      for (const slug of ['phantom_quartet', 'phantom_quintuplets', 'phantom_sextuplets', 'phantom_septuplets', 'phantom_octuplets'])
        if (this.captures >= (achievementThreshold(slug).captures ?? Number.MAX_SAFE_INTEGER)) candidates.push(slug);
    } else if (event.kind === 'over' && event.cleared === 0) {
      this.noobRuns.add(event.runId);
      if (this.noobRuns.size >= (achievementThreshold('noob').gameOvers ?? Number.MAX_SAFE_INTEGER)) candidates.push('noob');
    }
    const starter = achievementThreshold('spark_starter');
    if (event.peak >= (starter.peak ?? Number.MAX_SAFE_INTEGER) && event.deaths === (starter.deaths ?? 0)) candidates.push('spark_starter');
    if (event.peak >= (achievementThreshold('spark_keeper').peak ?? Number.MAX_SAFE_INTEGER)) candidates.push('spark_keeper');
    return candidates.filter(slug => {
      if (this.unlocked.has(slug)) return false;
      this.unlocked.add(slug); return true;
    });
  }

  confirm(slugs: string[]) { slugs.forEach(slug => this.unlocked.add(slug)); }
  snapshot(): LocalAchievementState { return { unlocked: [...this.unlocked], noobRuns: [...this.noobRuns] }; }
}
