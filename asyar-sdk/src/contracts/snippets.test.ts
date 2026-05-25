import { describe, it, expect } from 'vitest';
import { SHORTCODE_PATTERN, isValidShortcode, type ShortcodeMap } from './snippets';

describe('snippets contract', () => {
  it('accepts canonical :word: shortcodes', () => {
    expect(isValidShortcode(':party:')).toBe(true);
    expect(isValidShortcode(':red_heart:')).toBe(true);
    expect(isValidShortcode(':100:')).toBe(true);
    expect(isValidShortcode(':+1:')).toBe(true);
    expect(isValidShortcode(':a-b:')).toBe(true);
  });

  it('rejects missing colons', () => {
    expect(isValidShortcode('party')).toBe(false);
    expect(isValidShortcode(':party')).toBe(false);
    expect(isValidShortcode('party:')).toBe(false);
  });

  it('rejects uppercase, spaces, and out-of-charset chars', () => {
    expect(isValidShortcode(':Party:')).toBe(false);
    expect(isValidShortcode(':party emoji:')).toBe(false);
    expect(isValidShortcode(':party!:')).toBe(false);
  });

  it('rejects keys over 32 chars between colons', () => {
    const long = ':' + 'a'.repeat(33) + ':';
    expect(isValidShortcode(long)).toBe(false);
  });

  it('rejects empty key', () => {
    expect(isValidShortcode('::')).toBe(false);
  });

  it('SHORTCODE_PATTERN is a stable RegExp', () => {
    expect(SHORTCODE_PATTERN.source).toBe('^:[a-z0-9_+-]{1,32}:$');
  });

  it('ShortcodeMap is structurally a Record<string, string>', () => {
    const m: ShortcodeMap = { ':party:': '🎉' };
    expect(m[':party:']).toBe('🎉');
  });
});
