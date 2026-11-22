import { describe, it, expect } from 'vitest';
import { fire, step } from './confetti';

describe('confetti physics', () => {
  it('shoots pieces up from a bottom cannon, then gravity brings them down', () => {
    const [p] = fire(0, 1000, 60, 1, 1600, 1000, 1);
    step(p, 1);
    expect(p.y).toBeLessThan(1000);
    const peak = p.y;
    for (let i = 0; i < 200; i++) step(p, 1);
    expect(p.y).toBeGreaterThan(peak);
  });

  it('aims the right cannon back towards the centre', () => {
    const [p] = fire(1600, 1000, 120, 1, 1600, 1000, 1);
    step(p, 1);
    expect(p.x).toBeLessThan(1600);
  });
});
