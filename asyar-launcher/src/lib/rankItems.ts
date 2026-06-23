import { invoke } from '@tauri-apps/api/core';

/**
 * Field accessors that project an arbitrary item onto the shape the Rust
 * ranker understands. `title` is the primary match target; `subtitle` and
 * `keywords` are secondary. Only `id` and `title` are required.
 */
export interface RankableFields<T> {
  id: (item: T) => string;
  title: (item: T) => string;
  subtitle?: (item: T) => string | undefined;
  keywords?: (item: T) => string[];
}

/**
 * Rank a list against a query using the shared Rust tiered fuzzy ranker
 * (`rank_items` command, backed by `search_engine::ranker`). This is the single
 * search engine for the app — there is no JS fuzzy fallback.
 *
 * An empty/whitespace query returns the list unchanged without a round-trip.
 * Otherwise Rust returns matching ids best-first; non-matches are dropped.
 */
export async function rankItems<T>(
  query: string,
  items: T[],
  fields: RankableFields<T>,
): Promise<T[]> {
  const trimmed = query.trim();
  if (!trimmed) return items;

  const payload = items.map((item) => ({
    id: fields.id(item),
    title: fields.title(item),
    subtitle: fields.subtitle?.(item) ?? null,
    keywords: fields.keywords?.(item) ?? [],
  }));

  const orderedIds = await invoke<string[]>('rank_items', { query: trimmed, items: payload });

  const byId = new Map(items.map((item) => [fields.id(item), item]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
}
