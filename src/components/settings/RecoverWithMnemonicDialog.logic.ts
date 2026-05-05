import { BIP39_WORDLIST } from './bip39-english-wordlist';

export function isValidBip39Word(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (w.length === 0) return false;
  return BIP39_WORDLIST.includes(w);
}

export interface ParsedPhrase {
  /** Lowercased, trimmed, whitespace-split tokens. May be < 24 or > 24. */
  readonly words: readonly string[];
  /** Words present in the input that are NOT in the BIP-39 list. */
  readonly unknownWords: readonly string[];
  /** True only when count === 24 AND every word is a valid BIP-39 word. */
  readonly isValid: boolean;
}

/**
 * Parse free-form phrase input from a textarea — paste-friendly.
 *
 * Splits on any whitespace (spaces, newlines, tabs), normalises each
 * token to lowercase + trimmed, drops empties, then validates against
 * the BIP-39 list. The result feeds both the live "23/24 words" counter
 * and the "unknown words: 'aple'" hint shown next to the textarea.
 */
export function parsePhraseInput(raw: string): ParsedPhrase {
  const words = raw
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 0);

  const unknownWords = words.filter((w) => !BIP39_WORDLIST.includes(w));
  const isValid = words.length === 24 && unknownWords.length === 0;

  return { words, unknownWords, isValid };
}

/**
 * Join parsed words back into the canonical wire format the Rust side
 * expects: 24 lower-cased words separated by single spaces.
 */
export function joinPhraseForWire(words: readonly string[]): string {
  return words.join(' ');
}
