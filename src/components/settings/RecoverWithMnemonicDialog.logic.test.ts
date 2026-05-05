import { describe, it, expect } from 'vitest';
import {
  isValidBip39Word,
  parsePhraseInput,
  joinPhraseForWire,
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

describe('parsePhraseInput', () => {
  const validPhrase24 = Array.from(
    { length: 24 },
    (_, i) => BIP39_WORDLIST[i],
  ).join(' ');

  it('returns empty result for blank input', () => {
    const out = parsePhraseInput('');
    expect(out.words).toEqual([]);
    expect(out.unknownWords).toEqual([]);
    expect(out.isValid).toBe(false);
  });

  it('returns empty for whitespace-only input', () => {
    expect(parsePhraseInput('   \n\t  ').words).toEqual([]);
  });

  it('lowercases and trims each word', () => {
    const out = parsePhraseInput('  Abandon   ABILITY  zoo  ');
    expect(out.words).toEqual(['abandon', 'ability', 'zoo']);
  });

  it('splits on any whitespace (spaces, tabs, newlines)', () => {
    const out = parsePhraseInput('abandon\tability\nable\r\nabout');
    expect(out.words).toEqual(['abandon', 'ability', 'able', 'about']);
  });

  it('flags words not in the BIP-39 list as unknown', () => {
    const out = parsePhraseInput('abandon floofloo zoo banaa');
    expect(out.words).toEqual(['abandon', 'floofloo', 'zoo', 'banaa']);
    expect(out.unknownWords).toEqual(['floofloo', 'banaa']);
    expect(out.isValid).toBe(false);
  });

  it('isValid only when exactly 24 words AND zero unknowns', () => {
    expect(parsePhraseInput(validPhrase24).isValid).toBe(true);
  });

  it('isValid is false when count is wrong even if all words are valid', () => {
    const phrase23 = Array.from({ length: 23 }, (_, i) => BIP39_WORDLIST[i]).join(' ');
    expect(parsePhraseInput(phrase23).isValid).toBe(false);
    const phrase25 = `${validPhrase24} extra`;
    expect(parsePhraseInput(phrase25).isValid).toBe(false);
  });

  it('isValid is false when one of 24 words is unknown', () => {
    const phrase = validPhrase24.replace(/^abandon/, 'floofloo');
    const out = parsePhraseInput(phrase);
    expect(out.words).toHaveLength(24);
    expect(out.unknownWords).toEqual(['floofloo']);
    expect(out.isValid).toBe(false);
  });
});

describe('joinPhraseForWire', () => {
  it('joins with single spaces', () => {
    expect(joinPhraseForWire(['abandon', 'ability', 'able'])).toBe(
      'abandon ability able',
    );
  });
  it('produces an empty string for an empty array', () => {
    expect(joinPhraseForWire([])).toBe('');
  });
});
