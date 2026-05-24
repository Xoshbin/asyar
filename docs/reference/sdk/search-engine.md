### 8.10 `SearchEngine` — Client-side fuzzy search

**This is a utility class, not a service.** Import it directly — no `getService()` call, no IPC, no permissions needed.

```typescript
import { SearchEngine, stripHtml, stripRtf } from 'asyar-sdk';
```

`SearchEngine<T>` provides two-tier search: exact substring matching first, then fuzzy subsequence + typo-tolerant matching powered by [uFuzzy](https://github.com/leeoniya/uFuzzy). It runs synchronously in the caller's JS context — fast enough for keystroke-by-keystroke filtering of hundreds of items without debounce.

**Interface:**

```typescript
interface SearchEngineOptions<T> {
  /** Extract searchable text from an item. Called once per item when setItems() is called. */
  getText: (item: T) => string;

  /**
   * 'exact' — substring match only (fast, no typo tolerance)
   * 'fuzzy' — two-tier: exact substring first, then uFuzzy subsequence + typo tolerance (default)
   */
  mode?: 'exact' | 'fuzzy';
}

class SearchEngine<T> {
  constructor(options: SearchEngineOptions<T>);
  setItems(items: T[]): void;   // Rebuild index. Skips if same array reference.
  search(query: string): T[];   // Returns matching items ranked by relevance.
}
```

**Basic usage — searching a list of notes:**

```typescript
import { SearchEngine } from 'asyar-sdk';

interface Note {
  id: string;
  title: string;
  body: string;
}

const engine = new SearchEngine<Note>({
  getText: (note) => `${note.title} ${note.body}`,
});

// Call setItems() whenever your data changes
engine.setItems(myNotes);

// Search — returns matching notes ranked by relevance
const results = engine.search('qrtly rep');
// Finds notes containing "quarterly report" via subsequence matching
```

**How ranking works:**

1. **Exact substring matches** appear first (all query terms found as-is in the text).
2. **Fuzzy matches** appear after — these include subsequence matches (e.g., `"qrtly"` matches `"quarterly"`) and single-character typo tolerance (substitution, transposition, insertion, or deletion per term).

**Searching HTML or RTF content:**

Use the `stripHtml()` and `stripRtf()` utilities in your `getText` callback to convert markup to searchable plain text:

```typescript
import { SearchEngine, stripHtml } from 'asyar-sdk';

interface ClipboardEntry {
  id: string;
  htmlContent: string;
  preview: string;
}

const engine = new SearchEngine<ClipboardEntry>({
  getText: (entry) => `${entry.preview} ${stripHtml(entry.htmlContent)}`,
});
```

`stripHtml(html)` removes tags, script/style blocks, decodes common HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`), and collapses whitespace. `stripRtf(rtf)` removes RTF control words, unicode escapes, and formatting braces. Both are pure functions with no DOM dependency — they work in any JS environment.

**Exact mode — when you don't need fuzzy:**

```typescript
const engine = new SearchEngine<MyItem>({
  getText: (item) => item.name,
  mode: 'exact', // Only exact substring matching, no fuzzy
});
```

**Performance:**

- `setItems()` preprocesses text once — O(n) where n is item count.
- `search()` runs two passes: a fast substring scan, then a regex-based fuzzy filter on the same haystack. For 200 items, expect < 10ms total.
- `setItems()` skips the rebuild entirely if passed the same array reference (identity check). Safe to call on every render cycle.

---
