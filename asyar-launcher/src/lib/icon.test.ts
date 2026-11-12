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
      'http://asyar-icon.localhost/a.png',
      'http://asyar-thumb.localhost/a.png',
      'http://asyar-extension.localhost/org.x/a.png',
    ]) {
      expect(toResolvedIcon(raw, 'macos')).toBeNull();
      expect(toResolvedIcon(raw, 'other')).toBeNull();
    }
  });

  it('accepts and normalizes host schemes on Windows while keeping non-Windows strict', () => {
    expect(toResolvedIcon('http://asyar-icon.localhost/app.png', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-icon.localhost/app.png',
    });
    expect(toResolvedIcon('http://asyar-thumb.localhost/thumb.png', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-thumb.localhost/thumb.png',
    });
    expect(toResolvedIcon('http://asyar-extension.localhost/org.x/a.png?icon', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-extension.localhost/org.x/a.png?icon',
    });

    expect(toResolvedIcon('asyar-icon://localhost/app.png', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-icon.localhost/app.png',
    });
    expect(toResolvedIcon('asyar-thumb://localhost/thumb.png', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-thumb.localhost/thumb.png',
    });
    expect(toResolvedIcon('asyar-extension://org.x/a.png?icon', 'windows')).toEqual({
      kind: 'image',
      src: 'http://asyar-extension.localhost/org.x/a.png?icon',
    });
    expect(
      toResolvedIcon(
        {
          kind: 'image',
          src: 'asyar-extension://org.x/a.png?icon',
          dark: 'asyar-extension://org.x/b.png?icon',
        },
        'windows',
      ),
    ).toEqual({
      kind: 'image',
      src: 'http://asyar-extension.localhost/org.x/a.png?icon',
      dark: 'http://asyar-extension.localhost/org.x/b.png?icon',
    });
  });
});
