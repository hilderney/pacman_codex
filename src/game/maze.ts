import { DIRECTIONS, key, random, Tile, VECTOR, type Maze, type Point } from './types';

export const WIDTH = 28, HEIGHT = 31;
type Edge = [number, number];

export function walkable(maze: Maze, p: Point, ghosts = false): boolean {
  const tile = maze.tiles[p.y]?.[p.x];
  return tile === Tile.Floor || (ghosts && (tile === Tile.House || tile === Tile.Door));
}
export function neighbor(maze: Maze, p: Point, direction: keyof typeof VECTOR, ghosts = false): Point | null {
  const v = VECTOR[direction];
  const next = { x: p.x + v.x, y: p.y + v.y };
  if (maze.tunnels.includes(next.y)) next.x = (next.x + maze.width) % maze.width;
  return walkable(maze, next, ghosts) ? next : null;
}
export function neighbors(maze: Maze, p: Point, ghosts = false): Point[] {
  return DIRECTIONS.map(d => neighbor(maze, p, d, ghosts)).filter((n): n is Point => n !== null);
}
export function flood(maze: Maze, start: Point, ghosts = false): Set<string> {
  const seen = new Set([key(start)]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const p of neighbors(maze, queue[i], ghosts)) if (!seen.has(key(p))) {
      seen.add(key(p)); queue.push(p);
    }
  }
  return seen;
}

/** Carve a sparse, connected graph on the LEFT half only, then reflect it.
 * Removing edges instead of a spanning-tree carve preserves loops and avoids
 * long dead ends by construction. Validation below is still the final gate. */
function candidate(seed: number): Maze {
  const rng = random(seed), cols = 6, rows = 15, count = cols * rows;
  const graph = Array.from({ length: count }, () => new Set<number>());
  const edges: Edge[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = y * cols + x;
    for (const b of [x < cols - 1 ? a + 1 : -1, y < rows - 1 ? a + cols : -1]) {
      if (b >= 0) { graph[a].add(b); graph[b].add(a); edges.push([a, b]); }
    }
  }
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  for (const [a, b] of edges) {
    // This edge is the corridor directly outside the central house doors.
    if (a === 47 && b === 53 || graph[a].size <= 2 || graph[b].size <= 2 || rng() > .86) continue;
    graph[a].delete(b); graph[b].delete(a);
    const seen = new Set([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) for (const n of graph[queue[i]]) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    if (seen.size < count) { graph[a].add(b); graph[b].add(a); }
  }
  const tiles = Array.from({ length: HEIGHT }, () => Array<Tile>(WIDTH).fill(Tile.Wall));
  for (let a = 0; a < count; a++) {
    const x = 1 + 2 * (a % cols), y = 1 + 2 * Math.floor(a / cols);
    tiles[y][x] = Tile.Floor;
    for (const b of graph[a]) {
      const bx = 1 + 2 * (b % cols), by = 1 + 2 * Math.floor(b / cols);
      tiles[(y + by) / 2][(x + bx) / 2] = Tile.Floor;
    }
  }
  // A central one-tile gallery keeps even the house free of open 2x2 blocks.
  const bridges = [3 + 2 * Math.floor(rng() * 3), 11, 21, 27];
  for (const y of bridges) for (let x = 12; x < 14; x++) tiles[y][x] = Tile.Floor;
  tiles[16][12] = Tile.Door; tiles[16][13] = Tile.House;
  const tunnels = [7, 23];
  for (const y of tunnels) tiles[y][0] = Tile.Floor;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH / 2; x++) {
    tiles[y][WIDTH - x - 1] = tiles[y][x];
  }
  const maze: Maze = {
    width: WIDTH, height: HEIGHT, seed, tiles, spawn: { x: 13, y: 27 },
    house: { x: 13, y: 16 }, tunnels, dots: new Set(), powers: new Set(),
  };
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (tiles[y][x] === Tile.Floor) maze.dots.add(key({ x, y }));
  }
  // Choose one far-away node in each quadrant, symmetrically.
  for (const y of [1 + 2 * Math.floor(rng() * 3), 25 + 2 * Math.floor(rng() * 3)]) {
    const x = 1 + 2 * Math.floor(rng() * 2);
    for (const px of [x, WIDTH - 1 - x]) {
      const k = key({ x: px, y }); maze.powers.add(k); maze.dots.delete(k);
    }
  }
  return maze;
}

/** Independent tile-level checks, including wrap edges and house accessibility. */
export function validateMaze(maze: Maze): string[] {
  const errors: string[] = [], reachable = flood(maze, maze.spawn), all = flood(maze, maze.spawn, true);
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const p = { x, y };
    if (walkable(maze, p) && !reachable.has(key(p))) errors.push('isolated floor');
    if (walkable(maze, p, true) && !all.has(key(p))) errors.push('isolated house');
    if (x + 1 < maze.width && y + 1 < maze.height &&
      [p, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }].every(n => walkable(maze, n, true))) errors.push('open 2x2');
    const ns = walkable(maze, p) ? neighbors(maze, p) : [];
    if (ns.length === 1 && neighbors(maze, ns[0]).length <= 2) errors.push('deep dead end');
    if (maze.tiles[y][x] !== maze.tiles[y][maze.width - 1 - x]) errors.push('asymmetric');
  }
  for (const k of [...maze.dots, ...maze.powers]) if (!reachable.has(k)) errors.push('unreachable pickup');
  const openings = maze.tiles.flatMap((row, y) => row[0] === Tile.Floor ? [y] : []);
  if (openings.length !== 2 || openings.some(y => !maze.tunnels.includes(y) || maze.tiles[y][maze.width - 1] !== Tile.Floor)) errors.push('tunnels');
  if (maze.powers.size !== 4) errors.push('power count');
  const quadrants = new Set<string>();
  for (const k of maze.powers) {
    const [x, y] = k.split(',').map(Number);
    quadrants.add(`${x < maze.width / 2},${y < maze.height / 2}`);
    if (Math.abs(x - maze.house.x) + Math.abs(y - maze.house.y) < 12) errors.push('power near house');
  }
  if (quadrants.size !== 4) errors.push('power quadrants');
  return [...new Set(errors)];
}

export function generateMaze(seed: number): Maze {
  for (let attempt = 0; attempt < 64; attempt++) {
    const maze = candidate((seed + Math.imul(attempt, 0x9e3779b9)) >>> 0);
    if (validateMaze(maze).length === 0) return maze;
  }
  throw new Error('Unable to generate a valid maze');
}
