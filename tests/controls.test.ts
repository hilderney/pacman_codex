import { describe, expect, it } from 'vitest';
import { directionFromMovement } from '../src/services/controls';

describe('floating touch joystick', () => {
  it('uses a dead zone and chooses the dominant drag axis', () => {
    expect(directionFromMovement(4, 5)).toBeNull();
    expect(directionFromMovement(30, 8)).toBe('right');
    expect(directionFromMovement(-30, 8)).toBe('left');
    expect(directionFromMovement(8, -30)).toBe('up');
    expect(directionFromMovement(8, 30)).toBe('down');
  });
});
