---
order: 4
---
## 17. Complete Example — Bookmarks Extension

A complete production-ready extension demonstrating:
- A **view command** (open the bookmarks list).
- A **no-view command** (save today's date as a bookmark).
- **In-view search** (filter bookmarks as the user types).
- A **⌘K action** (clear all non-favorite bookmarks).
- **Notification feedback** via `NotificationService`.
- Svelte 5 Runes throughout.

### `manifest.json`

```json
{
  "id": "com.yourname.bookmarks",
  "name": "Bookmarks",
  "version": "1.0.0",
  "description": "Save and search your personal bookmarks quickly.",
  "author": "Your Name",
  "icon": "🔖",
  "type": "extension",
  "background": { "main": "dist/worker.js" },
  "searchable": true,
  "asyarSdk": "^2.4.0",
  "permissions": ["notifications:send"],
  "commands": [
    {
      "id": "open",
      "name": "Open Bookmarks",
      "description": "Browse your saved bookmarks",
      "mode": "view",
      "component": "BookmarksView"
    },
    {
      "id": "add-today",
      "name": "Bookmark Today's Date",
      "description": "Saves today's date to your bookmarks",
      "mode": "background"
    }
  ]
}
```

### `src/main.ts`

```typescript
import { mount } from 'svelte';
import BookmarksView from './BookmarksView.svelte';
import {
  ExtensionContext,
  type IActionService,
  type INotificationService,
} from 'asyar-sdk';

const extensionId = window.location.hostname || 'com.yourname.bookmarks';

// 1. Single context — one per iframe lifetime.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Signal readiness to the host.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// 3. Forward ⌘K to the host.
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    window.parent.postMessage({
      type: 'asyar:extension:keydown',
      payload: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
    }, '*');
  }
});

// 4. Resolve services once.
const notifService   = context.getService<INotificationService>('notifications');
const actionService  = context.getService<IActionService>('actions');

// 5. Handle no-view command (add-today) invoked by the host.
window.addEventListener('message', async (event) => {
  if (event.data?.type !== 'asyar:invoke:command') return;
  const { commandId } = event.data.payload;

  if (commandId === 'add-today') {
    const entry = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const stored: string[] = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');
    stored.unshift(entry);
    localStorage.setItem('bookmarks', JSON.stringify(stored));
    await notifService.send({ title: 'Bookmark Added', body: entry });
  }
});

// 6. Mount the view for the correct ?view= param.
const viewName = new URLSearchParams(window.location.search).get('view') || 'BookmarksView';

if (viewName === 'BookmarksView') {
  mount(BookmarksView, {
    target: document.getElementById('app')!,
    props: { actionService, notifService },
  });
}
```

### `src/BookmarksView.svelte`

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ActionContext, ActionCategory } from 'asyar-sdk';
  import type { IActionService, INotificationService } from 'asyar-sdk';

  interface Props {
    actionService: IActionService;
    notifService:  INotificationService;
  }
  let { actionService, notifService }: Props = $props();

  let bookmarks = $state<string[]>([]);
  let query = $state('');

  const filtered = $derived(
    query.trim()
      ? bookmarks.filter(b => b.toLowerCase().includes(query.toLowerCase()))
      : bookmarks
  );

  const ACTION_ID = 'com.yourname.bookmarks:clear-all';

  // --- In-view search listener ---
  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    if (event.data?.type === 'asyar:view:search') {
      query = event.data.payload?.query ?? '';
    }
  }

  onMount(() => {
    // Load from localStorage
    bookmarks = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');

    // Register in-view search listener
    window.addEventListener('message', handleMessage);

    // Register ⌘K action
    actionService.registerAction({
      id: ACTION_ID,
      title: 'Clear Non-Favorites',
      description: 'Remove all bookmarks that are not starred',
      icon: '🗑',
      extensionId: 'com.yourname.bookmarks',
      category: ActionCategory.DESTRUCTIVE,
      context: ActionContext.EXTENSION_VIEW,
      execute: clearNonFavorites,
    });
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
    actionService.unregisterAction(ACTION_ID); // Critical cleanup
  });

  function addBookmark() {
    const entry = query.trim();
    if (!entry) return;
    bookmarks = [entry, ...bookmarks];
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    query = '';
  }

  function removeBookmark(index: number) {
    bookmarks = bookmarks.filter((_, i) => i !== index);
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
  }

  async function clearNonFavorites() {
    bookmarks = [];
    localStorage.removeItem('bookmarks');
    await notifService.send({
      title: 'Bookmarks Cleared',
      body: 'All bookmarks have been removed.',
    });
  }
</script>

<div class="container">
  <header>
    <h1>🔖 Bookmarks</h1>
    <span class="count">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
  </header>

  {#if filtered.length === 0 && query}
    <p class="empty">No bookmarks match "{query}"</p>
  {:else if bookmarks.length === 0}
    <p class="empty">No bookmarks yet. Type below and press Enter to add one.</p>
  {:else}
    <ul>
      {#each filtered as bookmark, i}
        <li>
          <span>{bookmark}</span>
          <button onclick={() => removeBookmark(i)} aria-label="Delete">✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  <footer>
    <input
      type="text"
      bind:value={query}
      placeholder="Add a bookmark or search..."
      onkeydown={(e) => e.key === 'Enter' && addBookmark()}
    />
  </footer>
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: system-ui, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.5rem;
    border-bottom: 1px solid var(--separator);
  }
  h1 { font-size: 1rem; font-weight: 600; margin: 0; }
  .count { font-size: 0.75rem; opacity: 0.5; }
  ul { list-style: none; margin: 0; padding: 0.5rem 0; flex: 1; overflow-y: auto; }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    margin: 0 0.5rem;
  }
  li:hover { background: var(--bg-secondary); }
  li button {
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.4;
    font-size: 0.75rem;
    color: var(--text-primary);
  }
  li button:hover { opacity: 1; }
  .empty { padding: 2rem 1.25rem; opacity: 0.5; font-size: 0.875rem; }
  footer { padding: 0.75rem 1rem; border-top: 1px solid var(--separator); }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    box-sizing: border-box;
  }
  input:focus { border-color: var(--accent-primary); }
</style>
```

---
