---
order: 5
---
### In-view search (all types)

When your extension's panel is open and `searchable: true`, the Asyar search bar becomes your extension's input field. Two messages are dispatched:

| Message | When fired | Payload |
|---|---|---|
| `asyar:view:search` | On every keystroke | `{ query: string }` |
| `asyar:view:submit` | On Enter key | `{ query: string }` |

**Svelte 5 implementation:**
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
      results = myData.filter(item => item.includes(query));
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
