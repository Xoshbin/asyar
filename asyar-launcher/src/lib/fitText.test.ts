import { describe, it, expect } from 'vitest';
import { computeFitFontSize, computeSharedFitSize } from './fitText';

describe('computeFitFontSize', () => {
  it('keeps the max size when the text already fits', () => {
    expect(computeFitFontSize(32, 200, 300, 14)).toBe(32);
    expect(computeFitFontSize(32, 300, 300, 14)).toBe(32);
  });

  it('scales the font down proportionally to the overflow', () => {
    // Text is twice as wide as the panel → half the font size.
    expect(computeFitFontSize(32, 600, 300, 14)).toBe(16);
    // 25% overflow → 80% of the size.
    expect(computeFitFontSize(30, 500, 400, 14)).toBe(24);
  });

  it('never goes below the minimum', () => {
    expect(computeFitFontSize(32, 4000, 300, 14)).toBe(14);
  });

  it('is defensive about degenerate measurements', () => {
    expect(computeFitFontSize(32, 0, 300, 14)).toBe(32);
    expect(computeFitFontSize(32, 600, 0, 14)).toBe(32);
    expect(computeFitFontSize(0, 600, 300, 14)).toBe(0);
  });
});

describe('computeSharedFitSize', () => {
  const m = (maxFontPx: number, naturalWidthPx: number, availableWidthPx: number) => ({
    maxFontPx,
    naturalWidthPx,
    availableWidthPx,
    minFontPx: maxFontPx * 0.4,
  });

  it('uses the smaller fit so both members render at the same size', () => {
    // Member A fits at full size; B needs half → both get half.
    expect(computeSharedFitSize([m(32, 200, 300), m(32, 600, 300)])).toBe(16);
  });

  it('keeps the full size when every member fits', () => {
    expect(computeSharedFitSize([m(32, 200, 300), m(32, 250, 300)])).toBe(32);
  });

  it('ignores unmeasurable members instead of poisoning the result', () => {
    expect(computeSharedFitSize([m(0, 0, 0), m(32, 600, 300)])).toBe(16);
    expect(computeSharedFitSize([m(32, 600, 0)])).toBe(32);
    expect(computeSharedFitSize([])).toBe(0);
  });
});
