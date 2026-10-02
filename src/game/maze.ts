import { DIRECTIONS, key, random, Tile, VECTOR, type Maze, type Point } from './types';

export const WIDTH = 28, HEIGHT = 31;
export const MAX_WALL_COMPONENT = 8;

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

const adjacent = (p: Point) => DIRECTIONS.map(d => ({ x: p.x + VECTOR[d].x, y: p.y + VECTOR[d].y }));
const interior = (maze: Maze, p: Point) => p.x > 0 && p.x < maze.width - 1 && p.y > 0 && p.y < maze.height - 1;

/** Walls include the house and its doors: neither is a player corridor.
 * The fixed outer frame is not part of interior wall components. Counting the
 * whole component (not just straight runs) also bounds bends and branches. */
export function wallComponent(maze: Maze, start: Point): Point[] {
  if (!interior(maze, start) || walkable(maze, start)) return [];
  const queue = [start], seen = new Set([key(start)]);
  for (let i = 0; i < queue.length; i++) for (const p of adjacent(queue[i])) {
    if (interior(maze, p) && !walkable(maze, p) && !seen.has(key(p))) { seen.add(key(p)); queue.push(p); }
  }
  return queue;
}

/** A bridge is an edge whose removal disconnects a corridor or an entire loop.
 * Merely checking tile degree >= 2 misses loops with a single entrance. */
export function corridorBridges(maze: Maze): [Point, Point][] {
  const visited = new Map<string, number>(), low = new Map<string, number>(), bridges: [Point, Point][] = [];
  let time = 0;
  function visit(p: Point, parent: string | null) {
    const id = key(p); visited.set(id, ++time); low.set(id, time);
    for (const n of neighbors(maze, p)) {
      const next = key(n);
      if (next === parent) continue;
      if (!visited.has(next)) {
        visit(n, id); low.set(id, Math.min(low.get(id)!, low.get(next)!));
        if (low.get(next)! > visited.get(id)!) bridges.push([p, n]);
      } else low.set(id, Math.min(low.get(id)!, visited.get(next)!));
    }
  }
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (walkable(maze, { x, y }) && !visited.has(key({ x, y }))) visit({ x, y }, null);
  }
  return bridges;
}

/** Start with small wall islands and close selected LEFT-side corridor edges.
 * Every change is mirrored immediately, so the wall bound also holds across
 * the central seam. Never grow a large wall mass and hope to repair it later. */
function candidate(seed: number): Maze {
  const rng = random(seed);
  const tiles = Array.from({ length: HEIGHT }, () => Array<Tile>(WIDTH).fill(Tile.Wall));
  for (let y = 1; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH / 2; x++) {
    if (y % 2 === 1 || x < 12 && x % 2 === 1) tiles[y][x] = Tile.Floor;
  }
  tiles[16][12] = Tile.Door; tiles[16][13] = Tile.House;
  const tunnels = [7, 23];
  for (const y of tunnels) tiles[y][0] = Tile.Floor;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH / 2; x++) tiles[y][WIDTH - 1 - x] = tiles[y][x];
  const maze: Maze = {
    width: WIDTH, height: HEIGHT, seed, tiles, spawn: { x: 13, y: 27 },
    house: { x: 13, y: 16 }, tunnels, dots: new Set(), powers: new Set(),
  };
  const edges: Point[] = [];
  // The inner perimeter remains a loop; only the actual frame is exempt.
  for (let y = 2; y < HEIGHT - 2; y++) for (let x = 2; x < 12; x++) {
    if ((x + y) % 2 === 1 && !(x === 11 && y === 16)) edges.push({ x, y });
  }
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  for (const p of edges) {
    if (rng() > .9) continue;
    const pair = [p, { x: WIDTH - 1 - p.x, y: p.y }];
    for (const n of pair) tiles[n.y][n.x] = Tile.Wall;
    const valid = pair.every(n => wallComponent(maze, n).length <= MAX_WALL_COMPONENT &&
      [n, ...adjacent(n)].every(q => !interior(maze, q) || (walkable(maze, q)
        ? neighbors(maze, q).length >= 2 : adjacent(q).some(a => walkable(maze, a)))));
    if (!valid) for (const n of pair) tiles[n.y][n.x] = Tile.Floor;
  }
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
  const checkedWalls = new Set<string>();
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const p = { x, y };
    if (walkable(maze, p) && !reachable.has(key(p))) errors.push('isolated floor');
    if (walkable(maze, p, true) && !all.has(key(p))) errors.push('isolated house');
    if (x + 1 < maze.width && y + 1 < maze.height &&
      [p, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }].every(n => walkable(maze, n))) errors.push('open 2x2');
    const ns = walkable(maze, p) ? neighbors(maze, p) : [];
    if (walkable(maze, p) && ns.length < 2) errors.push('dead end');
    if (interior(maze, p) && !walkable(maze, p)) {
      if (!adjacent(p).some(n => walkable(maze, n))) errors.push('wall without adjacent corridor');
      if (!checkedWalls.has(key(p))) {
        const component = wallComponent(maze, p);
        component.forEach(n => checkedWalls.add(key(n)));
        if (component.length > MAX_WALL_COMPONENT) errors.push('wall component exceeds 8');
      }
    }
    if (maze.tiles[y][x] !== maze.tiles[y][maze.width - 1 - x]) errors.push('asymmetric');
  }
  if (corridorBridges(maze).length) errors.push('single-entry corridor');
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
