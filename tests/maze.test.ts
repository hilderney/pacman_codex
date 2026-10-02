import { describe, expect, it } from 'vitest';
import { corridorBridges, flood, generateMaze, neighbors, validateMaze, walkable } from '../src/game/maze';
import { key, Tile, type Maze, type Point } from '../src/game/types';

const sides = ({ x, y }: Point) => [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }];
const inner = ({ x, y }: Point) => x > 0 && x < 27 && y > 0 && y < 30;

describe('procedural generator', () => {
  it('independently checks 1,200 seeds, including wall islands, bends, house and no dead ends', () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 1200; seed++) {
      const maze = generateMaze(seed), floors = flood(maze, maze.spawn), errors: string[] = [];
      expect(validateMaze(maze), `seed ${seed}`).toEqual([]);
      expect([maze.width, maze.height]).toEqual([28, 31]);
      const checked = new Set<string>();
      for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
        const tile = maze.tiles[y][x], p = { x, y };
        if (tile !== maze.tiles[y][27 - x]) errors.push(`symmetry ${key(p)}`);
        if (tile === Tile.Floor) {
          if (!floors.has(key(p))) errors.push(`unreachable ${key(p)}`);
          if (maze.dots.has(key(p)) === maze.powers.has(key(p))) errors.push(`pickup coverage ${key(p)}`);
          if (neighbors(maze, p).length < 2) errors.push(`dead end ${key(p)}`);
        } else if (inner(p)) {
          // House/doors must touch a player corridor, not merely a ghost route.
          if (!sides(p).some(n => walkable(maze, n))) errors.push(`buried wall ${key(p)}`);
          if (!checked.has(key(p))) {
            const component = [p]; checked.add(key(p));
            for (let i = 0; i < component.length; i++) for (const n of sides(component[i])) {
              if (inner(n) && !walkable(maze, n) && !checked.has(key(n))) { checked.add(key(n)); component.push(n); }
            }
            if (component.length > 8) errors.push(`long wall ${key(p)}: ${component.length}`);
          }
        }
        if (x < 27 && y < 30 && [p, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }].every(n => walkable(maze, n))) errors.push(`2x2 ${key(p)}`);
      }
      expect(errors, `seed ${seed}`).toEqual([]);
      expect(corridorBridges(maze), `seed ${seed}: single-entry region`).toEqual([]);
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
    for (const seed of [0, 1, -1, 0xffffffff, 0x7fffffff, 4294967296]) expect(generateMaze(seed)).toEqual(generateMaze(seed));
  });
  it('rejects the red case: walls with no adjacent corridor', () => {
    const maze = generateMaze(12);
    for (let y = 12; y <= 14; y++) for (let x = 12; x <= 15; x++) maze.tiles[y][x] = Tile.Wall;
    expect(validateMaze(maze)).toContain('wall without adjacent corridor');
  });
  it('rejects the blue case: a 9-tile L wall although each straight segment is <= 5', () => {
    const maze = generateMaze(12);
    for (let x = 3; x <= 7; x++) maze.tiles[8][x] = Tile.Wall;
    for (let y = 9; y <= 12; y++) maze.tiles[y][7] = Tile.Wall;
    expect(validateMaze(maze)).toContain('wall component exceeds 8');
  });
  it('rejects even a single-tile dead end', () => {
    const maze = generateMaze(12); maze.tiles[1][2] = Tile.Wall;
    expect(validateMaze(maze)).toContain('dead end');
  });
  it('finds a bridge between two loops even when every floor has at least two exits', () => {
    const tiles = Array.from({ length: 7 }, () => Array<Tile>(13).fill(Tile.Wall));
    for (const left of [1, 9]) for (let y = 1; y <= 3; y++) for (let x = left; x <= left + 2; x++) {
      if (y === 1 || y === 3 || x === left || x === left + 2) tiles[y][x] = Tile.Floor;
    }
    for (let x = 4; x <= 8; x++) tiles[2][x] = Tile.Floor;
    const maze: Maze = { width: 13, height: 7, tiles, seed: 0, spawn: { x: 1, y: 1 }, house: { x: 1, y: 1 }, tunnels: [], dots: new Set(), powers: new Set() };
    for (let y = 0; y < 7; y++) for (let x = 0; x < 13; x++) if (tiles[y][x] === Tile.Floor) expect(neighbors(maze, { x, y }).length).toBeGreaterThanOrEqual(2);
    expect(corridorBridges(maze)).toHaveLength(6);
    expect(validateMaze(maze)).toContain('single-entry corridor');
  });
  it('detects isolated pickups and open 2x2 player corridors', () => {
    const maze = generateMaze(12); maze.tiles[0][0] = Tile.Floor; maze.tiles[0][1] = maze.tiles[1][0] = Tile.Wall;
    expect(validateMaze(maze)).toContain('isolated floor');
    maze.tiles[2][2] = maze.tiles[2][3] = maze.tiles[3][2] = maze.tiles[3][3] = Tile.Floor;
    expect(validateMaze(maze)).toContain('open 2x2');
    maze.dots.add('0,0'); expect(validateMaze(maze)).toContain('unreachable pickup');
  });
});
