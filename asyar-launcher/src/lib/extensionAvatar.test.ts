import { describe, it, expect } from 'vitest';
import { storeIconSrc } from './extensionAvatar';

describe('storeIconSrc', () => {
  it('uses an https icon URL served by the Store', () => {
    expect(storeIconSrc('https://asyar.org/storage/12/icon.png')).toBe(
      'https://asyar.org/storage/12/icon.png',
    );
  });

  it('has no image for emoji, built-in names, package paths or nothing', () => {
    expect(storeIconSrc('⏱️')).toBeUndefined();
    expect(storeIconSrc('icon:palette')).toBeUndefined();
    expect(storeIconSrc('assets/icon.svg')).toBeUndefined();
    expect(storeIconSrc('http://example.com/icon.png')).toBeUndefined();
    expect(storeIconSrc(null)).toBeUndefined();
    expect(storeIconSrc(undefined)).toBeUndefined();
  });
});
