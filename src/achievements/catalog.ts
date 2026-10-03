export interface AchievementCopy { name: string; description: string }

// Stable slugs live in the database; copy and badge geometry stay in the app
// so an administrator can add a catalog row without sending executable SVG.
const copy: Record<string, { en: AchievementCopy; pt: AchievementCopy }> = {
  ace_spirit: { en: { name: 'Ace Spirit', description: 'Clear one screen without dying on that screen.' }, pt: { name: 'Ace Spirit', description: 'Passe uma fase sem morrer nela.' } },
  noob: { en: { name: 'Noob', description: 'Game over three times before clearing screen one.' }, pt: { name: 'Noob', description: 'Tenha três Game Overs antes de passar a primeira fase.' } },
  neon_maze_king: { en: { name: 'Neon Maze King', description: 'Lead the ranking for 30 consecutive UTC days.' }, pt: { name: 'Neon Maze King', description: 'Lidere o placar por 30 dias UTC consecutivos.' } },
  first_light: { en: { name: 'First Light', description: 'Be first to clear 50 screens without dying.' }, pt: { name: 'First Light', description: 'Seja o primeiro a passar 50 fases sem morrer.' } },
  light_bringer: { en: { name: 'Light Bringer', description: 'Be first to clear 500 screens without dying.' }, pt: { name: 'Light Bringer', description: 'Seja o primeiro a passar 500 fases sem morrer.' } },
  neon_pioneer: { en: { name: 'Neon Pioneer', description: 'Be first to clear 50 screens in one run.' }, pt: { name: 'Neon Pioneer', description: 'Seja o primeiro a passar 50 fases numa partida.' } },
  spark_starter: { en: { name: 'Spark Starter', description: 'Reach 1,000 balance before your first death.' }, pt: { name: 'Spark Starter', description: 'Alcance 1.000 pontos antes da primeira morte.' } },
  spark_keeper: { en: { name: 'Spark Keeper', description: 'Reach a peak balance of 100,000.' }, pt: { name: 'Spark Keeper', description: 'Alcance um pico de 100.000 pontos.' } },
  still_standing: { en: { name: 'Still Standing', description: 'Lose more than 100,000 points in one death.' }, pt: { name: 'Still Standing', description: 'Perca mais de 100.000 pontos numa morte.' } },
  tunnel_loop: { en: { name: 'Tunnel Loop', description: 'Cross a side tunnel 101 times in one run.' }, pt: { name: 'Tunnel Loop', description: 'Atravesse os túneis 101 vezes numa partida.' } },
  amazind_circuit: { en: { name: 'Amazind Circuit', description: 'Clear 25 screens in one run without dying.' }, pt: { name: 'Amazind Circuit', description: 'Passe 25 fases numa partida sem morrer.' } },
  perfect_circuit: { en: { name: 'Perfect Circuit', description: 'Clear 100 screens in one run without dying.' }, pt: { name: 'Perfect Circuit', description: 'Passe 100 fases numa partida sem morrer.' } },
  ominius_circuit: { en: { name: 'Ominius Circuit', description: 'Clear 250 screens in one run without dying.' }, pt: { name: 'Ominius Circuit', description: 'Passe 250 fases numa partida sem morrer.' } },
  phantom_quartet: { en: { name: 'Phantom Quartet', description: 'Catch 4 echoes with one energy orb.' }, pt: { name: 'Phantom Quartet', description: 'Capture 4 ecos com uma única energia.' } },
  phantom_quintuplets: { en: { name: 'Phantom Quintuplets', description: 'Catch 5 echoes with one energy orb.' }, pt: { name: 'Phantom Quintuplets', description: 'Capture 5 ecos com uma única energia.' } },
  phantom_sextuplets: { en: { name: 'Phantom Sextuplets', description: 'Catch 6 echoes with one energy orb.' }, pt: { name: 'Phantom Sextuplets', description: 'Capture 6 ecos com uma única energia.' } },
  phantom_septuplets: { en: { name: 'Phantom Septuplets', description: 'Catch 7 echoes with one energy orb.' }, pt: { name: 'Phantom Septuplets', description: 'Capture 7 ecos com uma única energia.' } },
  phantom_octuplets: { en: { name: 'Phantom Octuplets', description: 'Catch 8 echoes with one energy orb.' }, pt: { name: 'Phantom Octuplets', description: 'Capture 8 ecos com uma única energia.' } },
};

export function achievementCopy(slug: string, locale: string): AchievementCopy {
  return copy[slug]?.[locale.startsWith('pt') ? 'pt' : 'en'] ?? { name: slug.replaceAll('_', ' '), description: '' };
}

export function badgeSvg(slug: string): string {
  const rank = ['phantom_quartet', 'phantom_quintuplets', 'phantom_sextuplets', 'phantom_septuplets', 'phantom_octuplets'].indexOf(slug);
  const circuit = ['amazind_circuit', 'perfect_circuit', 'ominius_circuit'].indexOf(slug);
  let art = '<path d="M24 5 41 14v20L24 43 7 34V14Z"/><path d="m24 12 12 7v10l-12 7-12-7V19Z"/>';
  if (rank >= 0) art = `<path d="M24 5 43 24 24 43 5 24Z"/><text x="24" y="31" text-anchor="middle" font-size="20" fill="currentColor" stroke="none">${rank + 4}</text>`;
  else if (circuit >= 0) art = `<circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="12"/><path d="M24 4v12m0 16v12M4 24h12m16 0h12"/><text x="24" y="29" text-anchor="middle" font-size="12" fill="currentColor" stroke="none">${circuit + 1}</text>`;
  else if (slug === 'neon_maze_king') art = '<path d="m5 15 8 8 11-14 11 14 8-8-4 24H9Z"/>';
  else if (slug === 'tunnel_loop') art = '<circle cx="12" cy="24" r="8"/><circle cx="36" cy="24" r="8"/><path d="M20 17h8m-8 14h8"/>';
  else if (slug.startsWith('spark_')) art = '<path d="m28 4-17 23h11l-3 17 18-25H26Z"/>';
  else if (slug === 'still_standing') art = '<path d="M24 4 41 11v13c0 11-7 18-17 21C14 42 7 35 7 24V11Z"/><path d="m25 10-5 15 8-2-4 15"/>';
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${art}</svg>`;
}
