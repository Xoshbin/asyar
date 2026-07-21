import { describe, it, expect } from 'vitest';
import { splitQuickCapture } from './quickCapture';

describe('splitQuickCapture', () => {
  it('uses the first line as the title and the rest as the body', () => {
    expect(splitQuickCapture('Buy milk\nand eggs\nand bread')).toEqual({
      title: 'Buy milk',
      body: 'and eggs\nand bread',
    });
  });

  it('single-line input becomes a title with an empty body', () => {
    expect(splitQuickCapture('Just a thought')).toEqual({ title: 'Just a thought', body: '' });
  });

  it('trims the title but preserves the body verbatim', () => {
    expect(splitQuickCapture('  spaced title  \n  body kept  ')).toEqual({
      title: 'spaced title',
      body: '  body kept  ',
    });
  });

  it('caps the title at 120 characters', () => {
    const long = 'x'.repeat(200);
    const { title, body } = splitQuickCapture(long);
    expect(title).toHaveLength(120);
    expect(body).toBe('');
  });

  it('handles empty input', () => {
    expect(splitQuickCapture('')).toEqual({ title: '', body: '' });
  });
});
