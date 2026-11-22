import { describe, it, expect, vi, afterEach } from 'vitest';
import { fire, step } from './confetti';

describe('confetti physics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shoots pieces up from a bottom cannon, then gravity brings them down', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const [p] = fire(0, 1000, 60, 1, 1600, 1000, 1);
    step(p, 1);
    expect(p.y).toBeLessThan(1000);
    for (let i = 0; i < 200; i++) step(p, 1);
    const before = p.y;
    step(p, 1);
    expect(p.y).toBeGreaterThan(before);
  });

  it('aims the right cannon back towards the centre', () => {
    const [p] = fire(1600, 1000, 120, 1, 1600, 1000, 1);
    step(p, 1);
    expect(p.x).toBeLessThan(1600);
  });
});
