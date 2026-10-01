import { neighbor, neighbors, walkable } from './maze';
import { DIRECTIONS, key, OPPOSITE, same, VECTOR, type Direction, type Maze, type Point } from './types';

/** Project predictive targets (which can land in walls) onto the nearest floor. */
export function nearestFloor(maze: Maze, target: Point): Point {
  let best = maze.spawn, distance = Infinity;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const d = Math.abs(x - target.x) + Math.abs(y - target.y);
    if (d < distance && walkable(maze, { x, y })) { best = { x, y }; distance = d; }
  }
  return best;
}

export function bfsDistances(maze: Maze, target: Point, houseAccess = false): Map<string, number> {
  const distances = new Map([[key(target), 0]]), queue = [target];
  for (let i = 0; i < queue.length; i++) for (const n of neighbors(maze, queue[i], houseAccess)) {
    if (!distances.has(key(n))) {
      distances.set(key(n), distances.get(key(queue[i]))! + 1); queue.push(n);
    }
  }
  return distances;
}

export function chooseDirection(maze: Maze, position: Point, current: Direction, target: Point,
  houseAccess: boolean, frightened: boolean, rng: () => number): Direction | null {
  const choices = DIRECTIONS.filter(d => neighbor(maze, position, d, houseAccess));
  const forward = choices.filter(d => d !== OPPOSITE[current]);
  const allowed = forward.length ? forward : choices;
  if (!allowed.length) return null;
  if (frightened) return allowed[Math.floor(rng() * allowed.length)];
  const distances = bfsDistances(maze, target, houseAccess);
  return allowed.reduce((best, d) => {
    const a = neighbor(maze, position, d, houseAccess)!, b = neighbor(maze, position, best, houseAccess)!;
    return (distances.get(key(a)) ?? Infinity) < (distances.get(key(b)) ?? Infinity) ? d : best;
  }, allowed[0]);
}

export function personalityTarget(id: number, maze: Maze, player: Point, facing: Direction,
  ghost: Point, leader: Point, scatter: boolean): Point {
  const corners = [{ x: 26, y: 1 }, { x: 1, y: 1 }, { x: 26, y: 29 }, { x: 1, y: 29 }];
  if (scatter) return corners[id];
  const v = VECTOR[facing];
  if (id === 0) return player; // Trace: direct pursuit.
  if (id === 1) return nearestFloor(maze, { x: player.x + v.x * 4, y: player.y + v.y * 4 }); // Veil: ambush.
  if (id === 2) return nearestFloor(maze, {
    x: 2 * (player.x + v.x * 2) - leader.x, y: 2 * (player.y + v.y * 2) - leader.y,
  }); // Flux: flank relative to Trace.
  return Math.abs(ghost.x - player.x) + Math.abs(ghost.y - player.y) > 8 && !same(ghost, player)
    ? player : corners[id]; // Drift: retreat when close.
}
