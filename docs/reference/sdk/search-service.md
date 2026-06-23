### 8.10 `SearchService` — Rank a list against a query

**Runs in:** both worker and view.

**Permission required:** None. You supply your own already-known items and get back an ordering — no host data is read, nothing is persisted, no cross-extension exposure.

`SearchService` ranks an arbitrary list against a query using the same tiered fuzzy ranker the launcher's own search uses (Rust `search_engine::ranker`, skim fuzzy matching). Use it for in-view lists instead of shipping your own fuzzy-match library.

```typescript
export interface RankableItem {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
}

export interface ISearchService {
  /**
   * Rank `items` against `query`. Returns matching ids, best match first.
   * Items with no match in any field are omitted. An empty/whitespace query
   * returns every id in input order.
   */
  rank(query: string, items: RankableItem[]): Promise<string[]>;
}
```

**Usage:**

```typescript
import type { ISearchService, RankableItem } from 'asyar-sdk/contracts';

const search = context.getService<ISearchService>('search');

interface Todo {
  id: string;
  text: string;
  notes?: string;
  tags?: string[];
}

function rankTodos(query: string, todos: Todo[]): Promise<Todo[]> {
  const items: RankableItem[] = todos.map(t => ({
    id: t.id,
    title: t.text,
    subtitle: t.notes,
    keywords: t.tags,
  }));

  return search.rank(query, items).then(orderedIds => {
    const byId = new Map(todos.map(t => [t.id, t]));
    return orderedIds.map(id => byId.get(id)!);
  });
}
```

**How ranking works:**

1. **Exact title match** — the query equals the title (case-insensitive).
2. **Title prefix** — the title starts with the query.
3. **Title fuzzy** — skim fuzzy match against the title (typo-tolerant subsequence matching, e.g. `"qrtly"` matches `"Quarterly Report"`).
4. **Subtitle or keyword** — fuzzy match against `subtitle` + `keywords` joined, when the title doesn't match at all.
5. Items matching nowhere are **omitted** from the result — `rank()` does not return non-matches.

Within each tier, results are ordered by fuzzy score, then alphabetically by title as a tiebreaker.

**`id` is opaque to the host:** it's returned verbatim, best match first, so you map ordered ids back to your own objects — the host never sees or needs your full item shape, only `title`/`subtitle`/`keywords`.

**Empty query:** an empty or whitespace-only query returns every id in input order — no ranking pass runs, so it's safe to call on every keystroke including when the search box is cleared.

**Scale limits.** `rank()` is stateless — there is no persistent index, and your full `items` array is sent over IPC on every call. Fine for keystroke-by-keystroke filtering of up to a few hundred items. Not a fit for thousands+.

| | `SearchService.rank()` | Indexed search (e.g. clipboard history) |
|---|---|---|
| State | Stateless — no index | Persistent index, built once |
| Per-call cost | Full item list sent every call | Query only; index already in Rust |
| Good for | A few hundred items (your own snippets, an extension catalog) | Thousands+ items |
| Available to extensions | Yes — this service | No — internal to the clipboard feature, not exposed via the SDK |

> If your list can grow into the thousands, don't pass a larger payload to `rank()` — that doesn't scale. Build a dedicated indexed-search command instead, the same way clipboard history's full-text search works internally.

---
