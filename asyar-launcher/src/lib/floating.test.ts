import { describe, expect, it } from 'vitest';
import { placeFloating } from './floating';

const anchor = { left: 40, right: 240, width: 200, top: 100, bottom: 132 };
const viewport = { width: 1000, height: 700 };

describe('placeFloating', () => {
  it('opens below the anchor at its width', () => {
    expect(placeFloating(anchor, viewport)).toEqual({
      left: 40,
      right: null,
      width: 200,
      top: 136,
      bottom: null,
    });
  });

  it('opens above the anchor, measured from the viewport bottom', () => {
    expect(placeFloating(anchor, viewport, { above: true })).toMatchObject({
      top: null,
      bottom: 604,
    });
  });

  it('right-aligns to the anchor and keeps its own width', () => {
    expect(placeFloating(anchor, viewport, { align: 'end' })).toMatchObject({
      left: null,
      right: 760,
      width: null,
    });
  });
});
