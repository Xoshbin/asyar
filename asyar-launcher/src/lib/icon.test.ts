import { describe, expect, it } from 'vitest';
import { toResolvedIcon } from './icon';

describe('toResolvedIcon', () => {
  it('classifies host strings', () => {
    expect(toResolvedIcon('icon:timer')).toEqual({ kind: 'glyph', name: 'timer' });
    expect(toResolvedIcon('🍅')).toEqual({ kind: 'emoji', value: '🍅' });
    expect(toResolvedIcon('asyar-thumb://localhost/a.png')).toEqual({
      kind: 'image',
      src: 'asyar-thumb://localhost/a.png',
    });
    expect(toResolvedIcon('https://x.dev/a.png')).toEqual({
      kind: 'remote',
      url: 'https://x.dev/a.png',
    });
  });

  it('passes typed icons through', () => {
    const icon = { kind: 'glyph', name: 'star' } as const;
    expect(toResolvedIcon(icon)).toBe(icon);
  });

  it('rejects what it cannot resolve without an owner', () => {
    for (const raw of [
      '',
      'icon:',
      'assets/x.png',
      '../x.png',
      'file:///x.png',
      'http://x.dev/a.png',
    ]) {
      expect(toResolvedIcon(raw)).toBeNull();
    }
  });
});
