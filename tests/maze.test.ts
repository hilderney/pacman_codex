import { describe, expect, it } from 'vitest';
import { flood, generateMaze, neighbors, validateMaze, walkable } from '../src/game/maze';
import { key, Tile } from '../src/game/types';

describe('procedural generator', () => {
  it('independently checks 1,200 seeds for every mandatory invariant', () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 1200; seed++) {
      const maze = generateMaze(seed), floors = flood(maze, maze.spawn);
      expect(validateMaze(maze), `seed ${seed}`).toEqual([]);
      expect([maze.width, maze.height]).toEqual([28, 31]);
      for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
        const tile = maze.tiles[y][x], p = { x, y };
        expect(tile).toBe(maze.tiles[y][maze.width - x - 1]);
        if (tile === Tile.Floor) {
          expect(floors.has(key(p))).toBe(true);
          expect(maze.dots.has(key(p)) !== maze.powers.has(key(p))).toBe(true);
          const ns = neighbors(maze, p);
          if (ns.length === 1) expect(neighbors(maze, ns[0]).length).toBeGreaterThan(2);
        }
        if (x < 27 && y < 30) expect([p, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }].every(n => walkable(maze, n, true))).toBe(false);
      }
      const opens = maze.tiles.flatMap((row, y) => row[0] === Tile.Floor ? [y] : []);
      expect(opens).toEqual(maze.tunnels); expect(opens).toHaveLength(2);
      expect(maze.tiles[0].every(t => t === Tile.Wall)).toBe(true);
      expect(maze.tiles[30].every(t => t === Tile.Wall)).toBe(true);
      const quadrants = new Set([...maze.powers].map(k => {
        const [x, y] = k.split(',').map(Number);
        expect(Math.abs(x - 13) + Math.abs(y - 16)).toBeGreaterThanOrEqual(12);
        return `${x < 14},${y < 15.5}`;
      }));
      expect(quadrants.size).toBe(4);
      expect(flood(maze, maze.spawn, true).has(key(maze.house))).toBe(true);
      expect(maze.tiles.flat().filter(t => t === Tile.Door)).toHaveLength(2);
      layouts.add(maze.tiles.map(row => row.join('')).join(''));
    }
    expect(layouts.size).toBeGreaterThan(1100);
  });
  it('is reproducible, including extreme seeds', () => {
    for (const seed of [0, 1, -1, 0xffffffff, 0x7fffffff, 4294967296])
      expect(generateMaze(seed)).toEqual(generateMaze(seed));
  });
  it('detects corrupted topology instead of silently accepting it', () => {
    const maze = generateMaze(12); maze.tiles[0][0] = Tile.Floor;
    expect(validateMaze(maze)).toContain('isolated floor');
    maze.tiles[2][2] = maze.tiles[2][3] = maze.tiles[3][2] = maze.tiles[3][3] = Tile.Floor;
    expect(validateMaze(maze)).toContain('open 2x2');
    maze.dots.add('0,0'); expect(validateMaze(maze)).toContain('unreachable pickup');
  });
});
