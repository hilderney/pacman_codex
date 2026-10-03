import rawConfig from './config.json';

export interface AchievementThreshold {
  screenDeaths?: number;
  gameOvers?: number;
  maxCleared?: number;
  days?: number;
  cleared?: number;
  deaths?: number;
  peak?: number;
  penaltyGreaterThan?: number;
  tunnels?: number;
  captures?: number;
}

export interface AchievementConfig {
  version: number;
  thresholds: Record<string, AchievementThreshold>;
}

export const achievementConfig = rawConfig as AchievementConfig;

export function achievementThreshold(slug: string): AchievementThreshold {
  return achievementConfig.thresholds[slug] ?? {};
}
