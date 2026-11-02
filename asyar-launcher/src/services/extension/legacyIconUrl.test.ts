import { describe, it, expect } from 'vitest';
import { legacyIconUrl } from './legacyIconUrl';

// Old-format fixture: the `iconUrl` values responses carried before the icon resolver.
describe('legacyIconUrl', () => {
  it.each([
    [{ kind: 'glyph', name: 'calculator' }, 'icon:calculator'],
    [{ kind: 'emoji', value: '🧪' }, '🧪'],
    [{ kind: 'image', src: 'asyar-extension://ext/icon.png' }, 'asyar-extension://ext/icon.png'],
    [{ kind: 'image', src: 'asyar-icon://a/icon.png' }, 'asyar-icon://a/icon.png'],
    [{ kind: 'remote', url: 'https://example.com/i.png' }, 'https://example.com/i.png'],
    [null, undefined],
  ] as const)('%o → %s', (icon, iconUrl) => {
    expect(legacyIconUrl(icon)).toBe(iconUrl);
  });
});
