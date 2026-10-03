import { DragGesture } from '@use-gesture/vanilla';
import type { Direction } from '../game/types';
import type { Settings } from './storage';

export interface JoystickState { active: boolean; x: number; y: number; dx: number; dy: number }
export function directionFromMovement(x: number, y: number, deadZone = 14): Direction | null {
  if (Math.hypot(x, y) < deadZone) return null;
  return Math.abs(x) > Math.abs(y) ? x > 0 ? 'right' : 'left' : y > 0 ? 'down' : 'up';
}

export class Controls {
  private gesture: DragGesture;
  private startDown = false;
  capturing = false;
  constructor(private canvas: HTMLCanvasElement, public settings: Settings,
    private direction: (direction: Direction) => void, private pause: () => void,
    private isPlaying: () => boolean, private joystick: (state: JoystickState) => void = () => {}) {
    window.addEventListener('keydown', this.keydown);
    this.gesture = new DragGesture(canvas, ({ movement: [x, y], xy: [clientX, clientY], first, last }) => {
      if (!this.isPlaying()) { this.joystick({ active: false, x: 0, y: 0, dx: 0, dy: 0 }); return; }
      const rect = canvas.getBoundingClientRect();
      const centerX = clientX - rect.left - x, centerY = clientY - rect.top - y;
      const distance = Math.hypot(x, y), scale = distance > 32 ? 32 / distance : 1;
      this.joystick({ active: !last, x: centerX, y: centerY, dx: x * scale, dy: y * scale });
      if (first || last) return;
      const next = directionFromMovement(x, y);
      if (next) this.direction(next);
    }, { eventOptions: { passive: false }, filterTaps: true, pointer: { touch: true } });
  }
  private keydown = (event: KeyboardEvent) => {
    if (this.capturing || !this.isPlaying() || event.ctrlKey || event.metaKey || event.altKey ||
      (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName))) return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) this.pause(); return;
    }
    for (const [direction, keys] of Object.entries(this.settings.keys)) if (keys.includes(event.code)) {
      event.preventDefault(); this.direction(direction as Direction); return;
    }
  };
  poll(): boolean {
    let pads: (Gamepad | null)[] = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { return false; }
    const pad = pads.find(Boolean);
    if (!pad || !this.settings.gamepad || !this.isPlaying() || this.capturing) { this.startDown = false; return !!pad; }
    const start = pad.buttons[9]?.pressed ?? false;
    if (start && !this.startDown) this.pause();
    this.startDown = start;
    const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
    if (pad.buttons[12]?.pressed) this.direction('up');
    else if (pad.buttons[13]?.pressed) this.direction('down');
    else if (pad.buttons[14]?.pressed) this.direction('left');
    else if (pad.buttons[15]?.pressed) this.direction('right');
    else if (Math.max(Math.abs(x), Math.abs(y)) > .35)
      this.direction(Math.abs(x) > Math.abs(y) ? x > 0 ? 'right' : 'left' : y > 0 ? 'down' : 'up');
    return true;
  }
  destroy() { window.removeEventListener('keydown', this.keydown); this.gesture.destroy(); }
}
