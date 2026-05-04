import { BIP39_WORDLIST } from './bip39-english-wordlist';

export function isValidBip39Word(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (w.length === 0) return false;
  return BIP39_WORDLIST.includes(w);
}

export function autocompleteSuggestions(
  prefix: string,
  limit = 5,
): readonly string[] {
  const p = prefix.toLowerCase().trim();
  if (p.length < 2) return [];
  return BIP39_WORDLIST.filter((w) => w.startsWith(p)).slice(0, limit);
}

export function normalizePhraseInput(raw: readonly string[]): string {
  return raw
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 0)
    .join(' ');
}

export function isComplete24Words(raw: readonly string[]): boolean {
  return raw.length === 24 && raw.every((w) => w.trim().length > 0);
}
