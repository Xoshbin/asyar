---
order: 5
---

### In-view search (all types)

When your extension's panel is open and `searchable: true`, the Asyar search bar becomes your extension's input field. Two messages are dispatched:

| Message             | When fired         | Payload             |
| ------------------- | ------------------ | ------------------- |
| `asyar:view:search` | On every keystroke | `{ query: string }` |
| `asyar:view:submit` | On Enter key       | `{ query: string }` |

**Typed SDK helpers (`asyar-sdk/view`):**

Use `onSearch` and `onKey` from `asyar-sdk/view` to subscribe to search queries and forwarded keydown events without manually parsing `window` `message` events. Both return an unsubscribe function and leave raw `window.addEventListener('message', ...)` listeners untouched:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { onSearch, onKey, type ViewKeyEvent } from 'asyar-sdk/view';

  let query = $state('');
  let results = $state<string[]>([]);
  let unsubs: Array<() => void> = [];

  onMount(() => {
    unsubs = [
      onSearch((q) => {
        query = q;
        results = myData.filter((item) => item.includes(q));
      }),
      onKey((event: ViewKeyEvent) => {
        if (event.key === 'ArrowDown') {
          // Move selection
        }
      }),
    ];
  });

  onDestroy(() => {
    for (const unsub of unsubs) unsub();
  });
</script>
```

**Raw `message` listener (also supported for `asyar:view:submit`):**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let query = $state('');
  let results = $state<string[]>([]);

  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const { type, payload } = event.data;

    if (type === 'asyar:view:search') {
      query = payload?.query ?? '';
      // Filter or search your local data based on query
      results = myData.filter((item) => item.includes(query));
    }

    if (type === 'asyar:view:submit') {
      const submitted = payload?.query ?? '';
      if (submitted) handleSubmit(submitted);
    }
  }

  onMount(() => window.addEventListener('message', handleMessage));
  onDestroy(() => window.removeEventListener('message', handleMessage));

  function handleSubmit(value: string) {
    // e.g. send a chat message, run a search
  }
</script>
```
