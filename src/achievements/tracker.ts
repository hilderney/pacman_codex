import type { AchievementEvent } from '../game/engine';

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
      if (event.penalty > 100000) candidates.push('still_standing');
    } else if (event.kind === 'clear') {
      if (this.screenDeaths === 0) candidates.push('ace_spirit');
      this.screenDeaths = 0;
      if (event.deaths === 0) {
        if (event.cleared >= 25) candidates.push('amazind_circuit');
        if (event.cleared >= 50) candidates.push('first_light');
        if (event.cleared >= 100) candidates.push('perfect_circuit');
        if (event.cleared >= 250) candidates.push('ominius_circuit');
        if (event.cleared >= 500) candidates.push('light_bringer');
      }
      if (event.cleared >= 50) candidates.push('neon_pioneer');
    } else if (event.kind === 'tunnel') {
      if (++this.tunnelCount >= 101) candidates.push('tunnel_loop');
    } else if (event.kind === 'power') {
      this.powerId = event.powerId; this.captures = 0;
    } else if (event.kind === 'capture') {
      if (event.powerId !== this.powerId) { this.powerId = event.powerId; this.captures = 0; }
      this.captures++;
      for (const [slug, count] of [['phantom_quartet', 4], ['phantom_quintuplets', 5], ['phantom_sextuplets', 6], ['phantom_septuplets', 7], ['phantom_octuplets', 8]] as const)
        if (this.captures >= count) candidates.push(slug);
    } else if (event.kind === 'over' && event.cleared === 0) {
      this.noobRuns.add(event.runId);
      if (this.noobRuns.size >= 3) candidates.push('noob');
    }
    if (event.peak >= 1000 && event.deaths === 0) candidates.push('spark_starter');
    if (event.peak >= 100000) candidates.push('spark_keeper');
    return candidates.filter(slug => {
      if (this.unlocked.has(slug)) return false;
      this.unlocked.add(slug); return true;
    });
  }

  confirm(slugs: string[]) { slugs.forEach(slug => this.unlocked.add(slug)); }
  snapshot(): LocalAchievementState { return { unlocked: [...this.unlocked], noobRuns: [...this.noobRuns] }; }
}
