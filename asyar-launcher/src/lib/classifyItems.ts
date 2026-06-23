import { invoke } from '@tauri-apps/api/core';

/**
 * Field accessors that project an arbitrary item onto the shape the Rust
 * ranker understands. `title` is the primary match target; `subtitle` and
 * `keywords` are secondary. Only `id` and `title` are required.
 */
export interface ClassifiableFields<T> {
  id: (item: T) => string;
  title: (item: T) => string;
  subtitle?: (item: T) => string | undefined;
  keywords?: (item: T) => string[];
}

/**
 * Classify every item against `query` using the shared Rust tiered fuzzy
 * ranker (`classify_items` command, backed by `search_engine::ranker::classify_many`).
 * Unlike `rankItems`, this keeps every id (no filtering, no sorting) and
 * returns the raw tier ordinal per id — for interleaving data that isn't in
 * the Rust search index (e.g. Run rows) against results tiered elsewhere.
 *
 * An empty/whitespace query or empty item list returns an empty map without
 * a round-trip; callers should fall back to their own "untiered" default.
 */
export async function classifyItems<T>(
  query: string,
  items: T[],
  fields: ClassifiableFields<T>,
): Promise<Map<string, number>> {
  const trimmed = query.trim();
  if (!trimmed || items.length === 0) return new Map();

  const payload = items.map((item) => ({
    id: fields.id(item),
    title: fields.title(item),
    subtitle: fields.subtitle?.(item) ?? null,
    keywords: fields.keywords?.(item) ?? [],
  }));

  const results = await invoke<{ id: string; tier: number }[]>('classify_items', {
    query: trimmed,
    items: payload,
  });

  return new Map(results.map((r) => [r.id, r.tier]));
}
