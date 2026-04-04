import uFuzzy from '@leeoniya/ufuzzy';
import type { SearchEngineOptions } from './types';

function isSubsequence(search: string, text: string): boolean {
  let si = 0;
  for (let ti = 0; ti < text.length && si < search.length; ti++) {
    if (search[si] === text[ti]) si++;
  }
  return si === search.length;
}

export class SearchEngine<T> {
  private _items: T[] = [];
  private _haystack: string[] = [];
  private readonly getText: (item: T) => string;
  private readonly mode: 'exact' | 'fuzzy';
  private readonly uf: uFuzzy;

  constructor(options: SearchEngineOptions<T>) {
    this.getText = options.getText;
    this.mode = options.mode ?? 'fuzzy';
    this.uf = new uFuzzy({
      intraMode: 1,
      intraIns: 12,
      intraSub: 1,
      intraTrn: 1,
      intraDel: 1,
    });
  }

  /**
   * Set the item list. Rebuilds the searchable text haystack.
   * Skips rebuild if the same array reference is passed (items unchanged).
   */
  setItems(items: T[]): void {
    if (items === this._items) return;
    this._items = items;
    this._haystack = items.map(this.getText);
  }

  /**
   * Search items. Returns matching items in relevance order.
   * Empty/whitespace query returns all items.
   */
  search(query: string): T[] {
    const q = query.trim();
    if (!q) return [...this._items];

    const qLower = q.toLowerCase();
    const terms = qLower.split(/\s+/).filter(Boolean);

    // Tier 1: Exact substring match (all terms must appear)
    const exactIndices: number[] = [];
    for (let i = 0; i < this._haystack.length; i++) {
      const h = this._haystack[i].toLowerCase();
      if (terms.every(t => h.includes(t))) {
        exactIndices.push(i);
      }
    }

    if (this.mode === 'exact') {
      return exactIndices.map(i => this._items[i]);
    }

    // Tier 2: Subsequence match (all terms appear as ordered subsequences)
    const subseqIndices: number[] = [];
    for (let i = 0; i < this._haystack.length; i++) {
      const h = this._haystack[i].toLowerCase();
      if (terms.every(t => isSubsequence(t, h))) {
        subseqIndices.push(i);
      }
    }

    // Tier 3: uFuzzy (typo tolerance)
    const idxs = this.uf.filter(this._haystack, q);
    let fuzzyRankedIndices: number[] = [];
    if (idxs && idxs.length > 0) {
      const info = this.uf.info(idxs, this._haystack, q);
      const order = this.uf.sort(info, this._haystack, q);
      fuzzyRankedIndices = order.map(i => idxs[i]);
    }

    // Merge: exact first, then subsequence, then fuzzy (de-duplicated)
    const exactItems = exactIndices.map(i => this._items[i]);
    const seen = new Set(exactIndices);

    const subseqOnlyItems = subseqIndices
      .filter(i => !seen.has(i))
      .map(i => { seen.add(i); return this._items[i]; });

    const fuzzyOnlyItems = fuzzyRankedIndices
      .filter(i => !seen.has(i))
      .map(i => this._items[i]);

    return [...exactItems, ...subseqOnlyItems, ...fuzzyOnlyItems];
  }
}
