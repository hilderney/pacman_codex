import { numberLocale, t } from '../i18n';
import { Game, visualPosition } from './engine';
import { Tile, type Point } from './types';

export const COLORS = ['#ff797e', '#ad9cff', '#71edd8', '#ffc56e'];
const TILE = 20;
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private walls = document.createElement('canvas');
  private cachedMaze?: Game['maze'];
  private scorePopups: { value: number; kind: 'power' | 'ghost' | 'fruit'; position: Point; born: number }[] = [];
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.width = 560; canvas.height = 620;
    this.walls.width = canvas.width; this.walls.height = canvas.height;
  }
  showScorePopup(event: { value: number; kind: 'power' | 'ghost' | 'fruit'; position: Point }) {
    this.scorePopups.push({ ...event, born: performance.now() / 1000 });
  }
  private cacheWalls(game: Game) {
    const ctx = this.walls.getContext('2d')!, maze = game.maze;
    ctx.clearRect(0, 0, 560, 620); ctx.fillStyle = '#090f1a'; ctx.fillRect(0, 0, 560, 620);
    // Draw only exposed wall faces: adjoining tiles read as continuous neon rails.
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#287178'; ctx.lineCap = 'round';
    ctx.shadowColor = '#36c8bd'; ctx.shadowBlur = 4;
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      const tile = maze.tiles[y][x], px = x * TILE, py = y * TILE;
      if (tile === Tile.Wall) {
        ctx.shadowBlur = 0; ctx.fillStyle = '#0d1c27'; ctx.fillRect(px, py, TILE, TILE); ctx.shadowBlur = 4;
        const floor = (nx: number, ny: number) => maze.tiles[ny]?.[nx] !== undefined && maze.tiles[ny][nx] !== Tile.Wall;
        ctx.beginPath();
        if (floor(x, y - 1)) { ctx.moveTo(px + 1, py + 3); ctx.lineTo(px + 19, py + 3); }
        if (floor(x, y + 1)) { ctx.moveTo(px + 1, py + 17); ctx.lineTo(px + 19, py + 17); }
        if (floor(x - 1, y)) { ctx.moveTo(px + 3, py + 1); ctx.lineTo(px + 3, py + 19); }
        if (floor(x + 1, y)) { ctx.moveTo(px + 17, py + 1); ctx.lineTo(px + 17, py + 19); }
        ctx.stroke();
      } else if (tile === Tile.Door) {
        ctx.fillStyle = '#ad9cff'; ctx.fillRect(px + 9, py + 3, 2, 14);
      }
    }
    ctx.shadowBlur = 0; this.cachedMaze = maze;
  }
  draw(game: Game, time: number, attract = false) {
    if (this.cachedMaze !== game.maze) this.cacheWalls(game);
    const ctx = this.ctx; ctx.clearRect(0, 0, 560, 620); ctx.drawImage(this.walls, 0, 0);
    ctx.fillStyle = '#a4baba';
    for (const k of game.maze.dots) {
      const [x, y] = k.split(',').map(Number); ctx.beginPath(); ctx.arc(x * TILE + 10, y * TILE + 10, 1.7, 0, Math.PI * 2); ctx.fill();
    }
    for (const k of game.maze.powers) {
      const [x, y] = k.split(',').map(Number);
      ctx.shadowColor = '#b4ffcb'; ctx.shadowBlur = 15; ctx.fillStyle = '#c5ffd9';
      ctx.beginPath(); ctx.arc(x * TILE + 10, y * TILE + 10, 4 + Math.sin(time * 3) * 1, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (game.fruit) {
      const { x, y } = game.fruit.pos;
      ctx.save(); ctx.translate(x * TILE + 10, y * TILE + 10); ctx.rotate(time);
      ctx.fillStyle = '#e4aaff'; ctx.shadowColor = '#e4aaff'; ctx.shadowBlur = 14;
      ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    }
    const player = visualPosition(game.player, game.maze.width);
    this.player(player, game.player.dir, time, game.phase === 'dying' ? Math.max(0, game.phaseTime / 1.3) : 1);
    for (const g of game.ghosts) {
      let p = visualPosition(g, game.maze.width);
      if (attract) p = [{ x: 11, y: 11 }, { x: 23, y: 7 }, { x: 4, y: 23 }, { x: 16, y: 21 }][g.id];
      const color = g.mode === 'frightened' ? (game.frightened < 2 && Math.sin(time * 15) > 0 ? '#f3f7f6' : '#467fe6') : COLORS[g.id];
      ctx.save(); ctx.translate(p.x * TILE + 10, p.y * TILE + 10 + Math.sin(time * 4 + g.id) * 1.3);
      if (g.mode !== 'eyes') {
        ctx.shadowBlur = 12; ctx.shadowColor = color; ctx.fillStyle = color;
        // Echoes are floating cut-corner crystals, an original silhouette.
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, -3); ctx.lineTo(6, 6); ctx.lineTo(0, 9); ctx.lineTo(-6, 6); ctx.lineTo(-7, -3); ctx.closePath(); ctx.fill();
      }
      ctx.shadowBlur = 0; ctx.fillStyle = g.mode === 'eyes' ? '#eaffff' : '#122233';
      ctx.fillRect(-4, -2, 2.5, 3); ctx.fillRect(1.5, -2, 2.5, 3); ctx.restore();
    }
    const now = performance.now() / 1000;
    this.scorePopups = this.scorePopups.filter(popup => now - popup.born < 1);
    for (const popup of this.scorePopups) {
      const age = now - popup.born;
      const alpha = Math.max(0, 1 - age);
      const rise = age * 30;
      ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.font = '700 12px monospace';
      ctx.fillStyle = popup.kind === 'ghost' ? '#8eb8ff' : popup.kind === 'fruit' ? '#e4aaff' : '#c5ffd9';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
      ctx.fillText(`+${popup.value.toLocaleString(numberLocale)}`, popup.position.x * TILE + 10, popup.position.y * TILE - 4 - rise);
      ctx.restore();
    }
    if (!attract && game.phase !== 'playing' && game.phase !== 'over') {
      this.banner(game.phase === 'ready' ? t.ready : game.phase === 'level-clear' ? t.clear : `${t.caught}  −${game.lastPenalty.toLocaleString(numberLocale)}`);
    }
  }
  private player(p: Point, direction: string, time: number, scale: number) {
    const ctx = this.ctx; ctx.save(); ctx.translate(p.x * TILE + 10, p.y * TILE + 10);
    ctx.rotate(({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 })[direction] ?? 0);
    ctx.scale(scale, scale); ctx.shadowColor = '#eaff87'; ctx.shadowBlur = 17; ctx.fillStyle = '#eaff87';
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2 - Math.sin(time * 12), 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  private banner(text: string) {
    const ctx = this.ctx; ctx.fillStyle = '#080e18e8'; ctx.fillRect(90, 278, 380, 60);
    ctx.fillStyle = '#eaff87'; ctx.textAlign = 'center'; ctx.font = '600 18px monospace'; ctx.fillText(text, 280, 315);
  }
}
