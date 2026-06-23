/**
 * An item to rank, shaped for the host's tiered fuzzy ranker. `id` is opaque
 * to the host — it is returned verbatim, best-match first, so the caller can
 * map ordered ids back to its own objects.
 */
export interface RankableItem {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
}

/**
 * The same tiered fuzzy ranker the launcher's own search uses (exact title →
 * title prefix → title fuzzy → subtitle/keyword), exposed so extensions don't
 * need to ship their own fuzzy-matching library for in-view lists.
 *
 * Stateless and side-effect-free: items are supplied on every call, nothing
 * is persisted or scoped per extension. No manifest permission is required.
 */
export interface ISearchService {
  /**
   * Rank `items` against `query`. Returns matching ids, best match first.
   * Items with no match in any field are omitted. An empty/whitespace query
   * returns every id in input order.
   */
  rank(query: string, items: RankableItem[]): Promise<string[]>;
}
