import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game/engine';
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
  it('loses exactly three lives and reports one game over', () => {
    const g = playing(), over = vi.fn(); g.onOver = over;
    for (let life = 3; life > 0; life--) {
      g.phase = 'playing'; const ghost = g.ghosts[0]; ghost.pos = { ...g.player.pos }; ghost.next = null;
      ghost.mode = 'normal'; ghost.release = 100; tick(g, .02);
      expect(g.lives).toBe(life - 1); expect(g.phase).toBe('dying'); tick(g, 1.4);
    }
    expect(g.phase).toBe('over'); tick(g, 10); expect(over).toHaveBeenCalledOnce();
  });
  it('clears a maze and uses a deterministic different seed for the next level', () => {
    const g = playing(), seed = g.maze.seed; g.maze.dots.clear(); g.maze.powers.clear();
    tick(g, .02); expect(g.phase).toBe('level-clear'); tick(g, 2);
    expect(g.level).toBe(2); expect(g.maze.seed).not.toBe(seed); expect(g.remaining).toBeGreaterThan(100);
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
});
