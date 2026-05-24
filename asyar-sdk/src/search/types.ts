export interface SearchEngineOptions<T> {
  /**
   * Extract searchable text from an item.
   * Called once per item when setItems() is called — not on every search.
   */
  getText: (item: T) => string;

  /**
   * 'exact'  — substring match only (fast, no typo tolerance)
   * 'fuzzy'  — two-tier: exact substring first, then uFuzzy subsequence + 1 typo per term
   * Default: 'fuzzy'
   */
  mode?: 'exact' | 'fuzzy';
}
