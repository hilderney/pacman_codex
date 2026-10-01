import type { Direction } from '../game/types';
export interface Settings { keys: Record<Direction, string[]>; volume: number; muted: boolean; gamepad: boolean }
export const defaults = (): Settings => ({
  keys: { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'] },
  volume: .45, muted: false, gamepad: true,
});
const memory = new Map<string, string>();
export let storageAvailable = true;
export const safeStorage = {
  getItem(k: string): string | null {
    try { return localStorage.getItem(k) ?? memory.get(k) ?? null; } catch { storageAvailable = false; return memory.get(k) ?? null; }
  },
  setItem(k: string, v: string) {
    memory.set(k, v);
    try { localStorage.setItem(k, v); } catch { storageAvailable = false; }
  },
  removeItem(k: string) { memory.delete(k); try { localStorage.removeItem(k); } catch { storageAvailable = false; } },
};
export function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(safeStorage.getItem(`neon:${key}`) ?? 'null') ?? fallback; } catch { return fallback; }
}
export function write(key: string, value: unknown) { safeStorage.setItem(`neon:${key}`, JSON.stringify(value)); }
export function loadSettings(): Settings {
  const raw = read<Partial<Settings>>('settings', {}), settings = defaults();
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) settings.volume = Math.min(1, Math.max(0, raw.volume));
  if (typeof raw.muted === 'boolean') settings.muted = raw.muted;
  if (typeof raw.gamepad === 'boolean') settings.gamepad = raw.gamepad;
  const allKeys: string[] = [];
  if (raw.keys && Object.keys(settings.keys).every(d => {
    const keys = raw.keys?.[d as Direction];
    if (!Array.isArray(keys) || keys.length !== 2 || keys.some(k => typeof k !== 'string' || !/^(Key[A-Z]|Arrow(Up|Down|Left|Right)|Digit[0-9]|Space)$/.test(k) || k === 'KeyP')) return false;
    allKeys.push(...keys); return true;
  }) && new Set(allKeys).size === 8) settings.keys = raw.keys;
  return settings;
}
export function bestScore() { const n = read<number>('best', 0); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
export function saveBest(score: number) { const best = Math.max(bestScore(), score); write('best', best); return best; }
