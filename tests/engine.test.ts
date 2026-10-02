import { describe, expect, it, vi } from 'vitest';
import { deathPenalty, Game, playerSpeed, speedMultiplier, visualPosition } from '../src/game/engine';
import { bfsDistances, chooseDirection, personalityTarget } from '../src/game/pathfinding';
import { neighbor } from '../src/game/maze';
import { key, Tile } from '../src/game/types';

const playing = () => { const g = new Game(18); g.phase = 'playing'; g.ghosts.forEach(x => { x.release = 10000; }); return g; };
const tick = (g: Game, seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) g.update(1 / 60); };
describe('simulation', () => {
  it('consumes dots once and does not move through walls', () => {
    const g = playing(); g.player.pos = { x: 1, y: 1 }; g.player.dir = 'up'; g.input('up');
    tick(g, 2); expect(g.player.pos).toEqual({ x: 1, y: 1 }); expect(g.score).toBe(10);
  });
  it('buffers a turn until the next valid junction', () => {
    const g = playing(); g.player.pos = { x: 13, y: 27 }; g.input('up');
    tick(g, 1); expect(g.player.dir).toBe('up'); expect(g.player.pos.y).toBeLessThan(27);
  });
  it('wraps both tunnels and keeps doors closed to the player', () => {
    const g = playing();
    for (const y of g.maze.tunnels) {
      expect(neighbor(g.maze, { x: 0, y }, 'left')).toEqual({ x: 27, y });
      expect(neighbor(g.maze, { x: 27, y }, 'right')).toEqual({ x: 0, y });
    }
    expect(neighbor(g.maze, { x: 11, y: 16 }, 'right')).toBeNull();
    expect(neighbor(g.maze, { x: 11, y: 16 }, 'right', true)).toEqual({ x: 12, y: 16 });
  });
  it('freezes the entire simulation while paused', () => {
    const g = playing(); g.frightened = 5; g.togglePause(); const before = JSON.stringify(g);
    tick(g, 20); expect(JSON.stringify(g)).toBe(before);
  });
  it('frightens echoes, awards a capture, then returns eyes to the house', () => {
    const g = playing(); const power = [...g.maze.powers][0].split(',').map(Number);
    g.player.pos = { x: power[0], y: power[1] }; g.player.dir = 'up'; g.input('up');
    const ghost = g.ghosts[0]; ghost.pos = { ...g.player.pos }; ghost.mode = 'normal';
    tick(g, .02); expect(ghost.mode).toBe('eyes'); expect(g.score).toBe(250); expect(g.frightened).toBeGreaterThan(0);
    ghost.pos = { x: 12, y: 16 }; ghost.next = { ...g.maze.house }; ghost.progress = .99; ghost.release = 0;
    tick(g, .02); expect(ghost.mode).toBe('leaving'); expect(ghost.release).toBeGreaterThan(0);
  });
  it('deducts 10, 20, 40, 80 across deaths and ends only when the balance reaches zero', () => {
    const g = playing(), over = vi.fn(), progress = vi.fn(); g.onOver = over; g.onProgress = progress;
    g.score = g.peakScore = 100;
    for (const [index, balance] of [90, 70, 30, 0].entries()) {
      g.phase = 'playing'; g.maze.dots.delete(key(g.player.pos));
      const ghost = g.ghosts[0]; ghost.pos = { ...g.player.pos }; ghost.next = null;
      ghost.mode = 'normal'; ghost.release = 100; tick(g, .02);
      expect(g.deaths).toBe(index + 1); expect(g.score).toBe(balance);
      expect(g.phase).toBe('dying'); tick(g, 1.4);
      if (balance > 0) expect(g.phase).toBe('ready');
    }
    expect(g.phase).toBe('over'); tick(g, 10); expect(over).toHaveBeenCalledOnce();
    expect(over.mock.calls[0][0]).toMatchObject({ score: 100, balance: 0, deaths: 4 });
    expect(progress).toHaveBeenCalledTimes(4);
    expect(g.nextPenalty).toBe(160);
  });
  it('starts at zero safely, but a death at zero is terminal; a new run resets all counters', () => {
    const g = playing(); g.maze.dots.delete(key(g.player.pos));
    expect(g.score).toBe(0); expect(g.phase).toBe('playing');
    const ghost = g.ghosts[0]; ghost.pos = { ...g.player.pos }; ghost.mode = 'normal'; ghost.release = 100;
    tick(g, .02); expect(g.score).toBe(0); expect(g.deaths).toBe(1); tick(g, 1.4); expect(g.phase).toBe('over');
    const fresh = new Game(18);
    expect([fresh.score, fresh.peakScore, fresh.deaths, fresh.cleared, fresh.level, fresh.nextPenalty]).toEqual([0, 0, 0, 0, 1, 10]);
  });
  it('keeps a peak balance independent of later penalties', () => {
    const g = playing(); g.score = 100; g.maze.dots.delete(key(g.player.pos)); g.maze.dots.add(key(g.player.pos));
    tick(g, .02); expect(g.peakScore).toBe(110);
    const ghost = g.ghosts[0]; ghost.pos = { ...g.player.pos }; ghost.mode = 'normal'; ghost.release = 100;
    tick(g, .02); expect(g.score).toBe(100); expect(g.peakScore).toBe(110);
  });
  it('clears a maze and uses a deterministic different seed for the next level', () => {
    const g = playing(), progress = vi.fn(), seed = g.maze.seed; g.onProgress = progress; g.maze.dots.clear(); g.maze.powers.clear(); g.deaths = 5; g.score = 300;
    tick(g, .02); expect(g.phase).toBe('level-clear'); expect(g.cleared).toBe(1); expect(progress).toHaveBeenCalledOnce(); tick(g, 2);
    expect(g.level).toBe(2); expect(g.maze.seed).not.toBe(seed); expect(g.remaining).toBeGreaterThan(100);
    expect(g.deaths).toBe(5); expect(g.nextPenalty).toBe(320); expect(g.score).toBe(300); expect(g.cleared).toBe(1);
  });
  it('spawns only two timed fruits per level and awards a collected fruit', () => {
    const g = playing(); g.collected = 70; tick(g, .02); expect(g.fruitMilestones.size).toBe(1);
    // First fruit was collected immediately at the spawn.
    expect(g.score).toBeGreaterThanOrEqual(100); g.player.pos = { x: 1, y: 1 }; g.player.dir = 'up'; g.input('up');
    g.collected = 170; tick(g, .02); expect(g.fruit).not.toBeNull(); tick(g, 13);
    expect(g.fruit).toBeNull(); expect(g.fruitMilestones.size).toBe(2);
  });
  it('cycles chase/scatter and pauses the cycle while frightened', () => {
    const g = playing(); expect(g.scatter).toBe(true); g.cycleTime = 8; expect(g.scatter).toBe(false);
    g.frightened = 5; tick(g, 1); expect(g.cycleTime).toBe(8);
  });
  it('finds shortest BFS paths and gives echoes distinct targets', () => {
    const g = playing(), target = { x: 1, y: 1 }, distances = bfsDistances(g.maze, target);
    expect(distances.get(key(target))).toBe(0);
    const direction = chooseDirection(g.maze, { x: 2, y: 1 }, 'left', target, false, false, () => 0);
    expect(direction).toBe('left');
    const targets = Array.from({ length: 4 }, (_, id) => personalityTarget(id, g.maze, { x: 11, y: 11 }, 'down', { x: 11, y: 12 }, { x: 7, y: 5 }, false));
    expect(new Set(targets.map(key)).size).toBe(4);
    expect(g.maze.tiles[g.maze.house.y][g.maze.house.x]).toBe(Tile.House);
  });
  it('increases speed linearly, doubles at screen 100 and continues beyond screen 999', () => {
    expect(speedMultiplier(1)).toBe(1); expect(speedMultiplier(100)).toBe(2);
    expect(playerSpeed(100)).toBeCloseTo(playerSpeed(1) * 2);
    expect(speedMultiplier(101) - speedMultiplier(100)).toBeCloseTo(speedMultiplier(2) - speedMultiplier(1));
    expect(playerSpeed(1000)).toBeGreaterThan(playerSpeed(999));
    expect([1, 2, 3, 4, 5].map(deathPenalty)).toEqual([10, 20, 40, 80, 160]);
    expect(Number.isFinite(deathPenalty(10000))).toBe(true);
    const g = playing(); g.level = 999; g.maze.dots.clear(); g.maze.powers.clear(); tick(g, 2);
    expect(g.level).toBe(1000); expect(g.remaining).toBeGreaterThan(100);
  });
  it('visits every crossed tile and honors collisions even at very high speeds', () => {
    const g = playing(); g.level = 10000; g.player.pos = { x: 1, y: 1 }; g.player.dir = 'right'; g.input('right'); g.ghosts = [];
    g.update(.02);
    expect(visualPosition(g.player, 28).x).toBeCloseTo(1 + playerSpeed(10000) * .02, 5);
    for (let x = 1; x <= g.player.pos.x; x++) expect(g.maze.dots.has(`${x},1`)).toBe(false);
    expect(g.player.progress).toBeLessThan(1);
    const chase = playing(); chase.level = 10000; chase.score = 100; chase.player.pos = { x: 1, y: 1 }; chase.player.dir = 'right'; chase.input('right');
    chase.ghosts[0].pos = { x: 8, y: 1 }; chase.ghosts[0].mode = 'normal';
    chase.update(.02); expect(chase.deaths).toBe(1); expect(chase.player.pos.x).toBeLessThan(8);
  });
});
