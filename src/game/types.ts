export type Direction = 'up' | 'down' | 'left' | 'right';
export type Point = { x: number; y: number };
export const DIRECTIONS: Direction[] = ['up', 'left', 'down', 'right'];
export const VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
export const key = (p: Point) => `${p.x},${p.y}`;
export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export enum Tile { Wall, Floor, Door, House }
export interface Maze {
  width: number; height: number; seed: number; tiles: Tile[][];
  spawn: Point; house: Point; tunnels: number[]; dots: Set<string>; powers: Set<string>;
}
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
