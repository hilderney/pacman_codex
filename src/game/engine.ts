import { generateMaze, neighbor } from './maze';
import { chooseDirection, personalityTarget } from './pathfinding';
import { key, random, same, type Direction, type Maze, type Point } from './types';

export type SoundEvent = 'dot' | 'power' | 'ghost' | 'death' | 'start' | 'fruit' | 'record';
export type Phase = 'ready' | 'playing' | 'dying' | 'level-clear' | 'over';
export interface Actor { pos: Point; next: Point | null; progress: number; dir: Direction }
export interface Ghost extends Actor { id: number; mode: 'normal' | 'frightened' | 'eyes' | 'leaving'; release: number }
// Submitted score is the highest balance reached, not the final zero balance.
export interface RunResult { score: number; level: number; durationMs: number; runId: string; deaths?: number; cleared?: number; balance?: number }
// Linear, not compounded: exactly 1x at screen 1, 2x at screen 100.
export const speedMultiplier = (level: number) => 1 + (Math.max(1, level) - 1) / 99;
export const playerSpeed = (level: number) => 5.8 * speedMultiplier(level);
export const deathPenalty = (death: number) => Math.min(Number.MAX_SAFE_INTEGER, 10 * 2 ** Math.min(50, Math.max(0, death - 1)));
const actor = (pos: Point): Actor => ({ pos: { ...pos }, next: null, progress: 0, dir: 'left' });

/** Pure simulation, with no DOM, audio, storage or network dependencies.
 * The app advances it in fixed 1/60-second steps, independent of refresh rate. */
export class Game {
  maze: Maze;
  player: Actor;
  ghosts: Ghost[] = [];
  phase: Phase = 'ready';
  paused = false;
  score = 0; peakScore = 0; level = 1; deaths = 0; cleared = 0; lastPenalty = 0;
  elapsed = 0; phaseTime = 1.8; frightened = 0; cycleTime = 0; levelTime = 0;
  combo = 0; collected = 0; fruit: { pos: Point; time: number } | null = null;
  fruitMilestones = new Set<number>();
  queued: Direction = 'left';
  rng: () => number;
  runId: string;
  onSound: (sound: SoundEvent) => void = () => {};
  // Called at meaningful run checkpoints so the client can sync the current
  // best result without sending a request for every collected point.
  onProgress: (result: RunResult) => void = () => {};
  onOver: (result: RunResult) => void = () => {};

  constructor(public seed = Date.now() >>> 0, runId = crypto.randomUUID()) {
    this.runId = runId; this.rng = random(seed); this.maze = generateMaze(seed); this.player = actor(this.maze.spawn);
    this.resetActors();
  }
  get scatter() { return this.cycleTime % 27 < 7; }
  get nextPenalty() { return deathPenalty(this.deaths + 1); }
  get remaining() { return this.maze.dots.size + this.maze.powers.size; }
  snapshot(): RunResult {
    return { score: this.peakScore, level: this.level, durationMs: Math.floor(this.elapsed * 1000), runId: this.runId,
      balance: this.score, deaths: this.deaths, cleared: this.cleared };
  }
  input(direction: Direction) { this.queued = direction; }
  togglePause() { if (this.phase !== 'over') this.paused = !this.paused; }

  resetActors() {
    this.player = actor(this.maze.spawn); this.queued = 'left';
    this.ghosts = Array.from({ length: 4 }, (_, id) => ({
      ...actor({ x: id % 2 ? 14 : 13, y: 16 }), id, mode: 'leaving', release: .8 + id * 1.7,
    }));
    this.frightened = 0; this.cycleTime = 0; this.phaseTime = 1.8;
  }

  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || this.paused || this.phase === 'over') return;
    // Subdivide high-speed movement to preserve turns, pickups and collisions
    // at arbitrarily late screens, without imposing a speed/level ceiling.
    const steps = Math.max(1, Math.ceil(dt * 11 * speedMultiplier(this.level) / .2));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private step(dt: number) {
    if (this.paused || this.phase === 'over') return;
    if (this.phase !== 'playing') {
      this.phaseTime -= dt;
      if (this.phaseTime > 0) return;
      if (this.phase === 'dying') {
        if (this.score <= 0) {
          this.phase = 'over';
          this.onOver(this.snapshot());
          return;
        }
        this.resetActors(); this.phase = 'ready'; return;
      }
      if (this.phase === 'level-clear') {
        this.level++; this.maze = generateMaze((this.seed + Math.imul(this.level - 1, 7919)) >>> 0);
        this.collected = 0; this.fruit = null; this.fruitMilestones.clear(); this.levelTime = 0;
        this.resetActors(); this.phase = 'ready'; return;
      }
      this.phase = 'playing'; this.onSound('start');
    }
    this.elapsed += dt; this.levelTime += dt;
    if (this.frightened > 0) {
      this.frightened = Math.max(0, this.frightened - dt);
      if (!this.frightened) for (const g of this.ghosts) if (g.mode === 'frightened') g.mode = 'normal';
    } else this.cycleTime += dt;
    if (this.fruit) { this.fruit.time -= dt; if (this.fruit.time <= 0) this.fruit = null; }
    this.move(this.player, playerSpeed(this.level), dt, () => {
      // The queued turn survives blocked intersections until it can be taken.
      return neighbor(this.maze, this.player.pos, this.queued) ? this.queued : this.player.dir;
    }, false, () => this.collect());
    this.collect();
    if (this.collisions()) return;
    for (const ghost of this.ghosts) {
      ghost.release -= dt;
      if (ghost.release > 0) continue;
      const speed = (ghost.mode === 'eyes' ? 11 : ghost.mode === 'frightened' ? 3.2 : 5.8 * (.82 + ghost.id * .025)) * speedMultiplier(this.level);
      this.move(ghost, speed, dt, () => {
        const target = ghost.mode === 'eyes' ? this.maze.house : ghost.mode === 'leaving'
          ? { x: ghost.id % 2 ? 16 : 11, y: 16 }
          : personalityTarget(ghost.id, this.maze, this.player.pos, this.player.dir, ghost.pos, this.ghosts[0].pos, this.scatter);
        return chooseDirection(this.maze, ghost.pos, ghost.dir, target,
          ghost.mode === 'eyes' || ghost.mode === 'leaving', ghost.mode === 'frightened', this.rng);
      }, ghost.mode === 'eyes' || ghost.mode === 'leaving', () => {
        if (ghost.mode === 'eyes' && same(ghost.pos, this.maze.house)) {
          ghost.mode = 'leaving'; ghost.release = 1.2;
        } else if (ghost.mode === 'leaving' && (ghost.pos.x === 11 || ghost.pos.x === 16)) ghost.mode = 'normal';
      });
    }
    if (this.collisions()) return;
    if (this.remaining === 0) {
      this.cleared++; this.phase = 'level-clear'; this.phaseTime = 1.8; this.onProgress(this.snapshot());
    }
  }

  private move(entity: Actor, speed: number, dt: number, decide: () => Direction | null,
    houseAccess: boolean, arrive: () => void) {
    if (!entity.next) {
      const direction = decide();
      if (!direction) return;
      const next = neighbor(this.maze, entity.pos, direction, houseAccess);
      if (!next) return;
      entity.dir = direction; entity.next = next;
    }
    entity.progress += speed * dt;
    if (entity.progress >= 1) {
      entity.pos = entity.next; entity.next = null; entity.progress -= 1; arrive();
    }
  }

  private collect() {
    const k = key(this.player.pos);
    if (this.maze.dots.delete(k)) { this.addScore(10); this.collected++; this.onSound('dot'); }
    if (this.maze.powers.delete(k)) {
      this.addScore(50); this.collected++; this.frightened = 7; this.combo = 0;
      for (const g of this.ghosts) if (g.mode === 'normal' || g.mode === 'frightened') g.mode = 'frightened';
      this.onSound('power');
    }
    for (const milestone of [70, 170]) if (this.collected >= milestone && !this.fruitMilestones.has(milestone)) {
      this.fruitMilestones.add(milestone); this.fruit = { pos: this.maze.spawn, time: 12 };
    }
    if (this.fruit && same(this.player.pos, this.fruit.pos)) {
      this.addScore(Math.min(1000, 100 * this.level)); this.fruit = null; this.onSound('fruit');
    }
  }

  private addScore(points: number) {
    this.score += points;
    this.peakScore = Math.max(this.peakScore, this.score);
  }

  private collisions(): boolean {
    const p = visualPosition(this.player, this.maze.width);
    for (const ghost of this.ghosts) {
      if (ghost.mode === 'eyes' || ghost.mode === 'leaving') continue;
      const g = visualPosition(ghost, this.maze.width);
      const rawX = Math.abs(p.x - g.x), dx = Math.min(rawX, this.maze.width - rawX);
      if (Math.hypot(dx, p.y - g.y) > .68) continue;
      if (ghost.mode === 'frightened') {
        ghost.mode = 'eyes'; this.addScore(200 * 2 ** Math.min(this.combo++, 3)); this.onSound('ghost');
      } else {
        this.deaths++;
        this.lastPenalty = Math.min(this.score, deathPenalty(this.deaths));
        this.score = Math.max(0, this.score - this.lastPenalty);
        this.phase = 'dying'; this.phaseTime = 1.3; this.onSound('death'); this.onProgress(this.snapshot()); return true;
      }
    }
    return false;
  }
}

export function visualPosition(actor: Actor, width: number): Point {
  if (!actor.next) return actor.pos;
  let dx = actor.next.x - actor.pos.x;
  if (Math.abs(dx) > 1) dx = dx > 0 ? -1 : 1;
  return { x: (actor.pos.x + dx * actor.progress + width) % width,
    y: actor.pos.y + (actor.next.y - actor.pos.y) * actor.progress };
}
