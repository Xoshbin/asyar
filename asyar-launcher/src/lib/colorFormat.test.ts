import { describe, it, expect } from 'vitest';
import { colorFormatOf, sortColorFormats, splitColorQuery } from './colorFormat';

describe('colorFormat', () => {
  it('names the notation of a color string', () => {
    expect(colorFormatOf('#112233')).toBe('HEX');
    expect(colorFormatOf(' rgb(1, 2, 3)')).toBe('RGB');
    expect(colorFormatOf('HSL(0, 0%, 0%)')).toBe('HSL');
    expect(colorFormatOf('red')).toBeNull();
  });

  it('sorts HEX, RGB, HSL regardless of input order', () => {
    expect(sortColorFormats(['hsl(0, 0%, 0%)', '#000', 'rgb(0, 0, 0)'])).toEqual([
      '#000',
      'rgb(0, 0, 0)',
      'hsl(0, 0%, 0%)',
    ]);
  });

  it('splits a trailing "to <format>" off the source color', () => {
    expect(splitColorQuery('#ff8800 to hsl')).toEqual({ color: '#ff8800', target: 'HSL' });
    expect(splitColorQuery('rgb(1, 2, 3) TO hex')).toEqual({
      color: 'rgb(1, 2, 3)',
      target: 'HEX',
    });
    expect(splitColorQuery('#ff8800')).toEqual({ color: '#ff8800', target: null });
  });
});
