import { describe, it, expect } from 'vitest';
import {
  isValidBip39Word,
  autocompleteSuggestions,
  normalizePhraseInput,
  isComplete24Words,
} from './RecoverWithMnemonicDialog.logic';
import { BIP39_WORDLIST } from './bip39-english-wordlist';

describe('BIP39_WORDLIST invariants', () => {
  it('contains exactly 2048 words', () => {
    expect(BIP39_WORDLIST).toHaveLength(2048);
  });
  it('starts with "abandon" and ends with "zoo"', () => {
    expect(BIP39_WORDLIST[0]).toBe('abandon');
    expect(BIP39_WORDLIST[2047]).toBe('zoo');
  });
  it('every word is lowercase ASCII', () => {
    BIP39_WORDLIST.forEach((w) => {
      expect(w).toMatch(/^[a-z]+$/);
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(w.length).toBeLessThanOrEqual(8);
    });
  });
});

describe('isValidBip39Word', () => {
  it('accepts a known BIP-39 word', () => {
    expect(isValidBip39Word('abandon')).toBe(true);
    expect(isValidBip39Word('zoo')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isValidBip39Word('ABANDON')).toBe(true);
    expect(isValidBip39Word('Abandon')).toBe(true);
  });
  it('trims whitespace', () => {
    expect(isValidBip39Word('  abandon  ')).toBe(true);
  });
  it('rejects an unknown word', () => {
    expect(isValidBip39Word('floofloo')).toBe(false);
    expect(isValidBip39Word('')).toBe(false);
  });
});

describe('autocompleteSuggestions', () => {
  it('returns empty for prefix shorter than 2', () => {
    expect(autocompleteSuggestions('a')).toEqual([]);
    expect(autocompleteSuggestions('')).toEqual([]);
  });
  it('returns words starting with the prefix', () => {
    const out = autocompleteSuggestions('aba');
    expect(out.length).toBeGreaterThan(0);
    out.forEach((w) => expect(w.startsWith('aba')).toBe(true));
  });
  it('limits results to default 5', () => {
    expect(autocompleteSuggestions('a').length).toBeLessThanOrEqual(5);
    expect(autocompleteSuggestions('ab').length).toBeLessThanOrEqual(5);
  });
  it('respects custom limit', () => {
    expect(autocompleteSuggestions('a', 3).length).toBeLessThanOrEqual(3);
  });
  it('is case-insensitive', () => {
    const a = autocompleteSuggestions('ABA');
    const b = autocompleteSuggestions('aba');
    expect(a).toEqual(b);
  });
});

describe('normalizePhraseInput', () => {
  it('joins, lowercases, trims', () => {
    expect(normalizePhraseInput(['Apple', '  Banana  ', 'CHERRY'])).toBe(
      'apple banana cherry',
    );
  });
  it('drops empty entries', () => {
    expect(normalizePhraseInput(['apple', '', 'banana'])).toBe('apple banana');
  });
});

describe('isComplete24Words', () => {
  it('true for exactly 24 non-empty entries', () => {
    const arr = Array.from({ length: 24 }, (_, i) => `w${i}`);
    expect(isComplete24Words(arr)).toBe(true);
  });
  it('false for fewer non-empty entries', () => {
    const arr = Array.from({ length: 24 }, (_, i) => (i < 23 ? `w${i}` : ''));
    expect(isComplete24Words(arr)).toBe(false);
  });
  it('false for arrays where length is wrong but non-empty count is 24', () => {
    // 25 entries with 24 non-empty — should still be false because the
    // dialog binds 24 inputs; an extra entry would be a logic error.
    const arr = ['', ...Array.from({ length: 24 }, (_, i) => `w${i}`)];
    expect(isComplete24Words(arr)).toBe(false);
  });
});
