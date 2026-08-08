---
name: tech-versions
description: Use when writing any frontend (Svelte/TypeScript) or Tauri integration code. Enforces Svelte 5 runes and Tauri 2 APIs. Triggers when writing components, reactive state, event handlers, invoke calls, Tauri commands, managed state, IPC event listeners, or SvelteKit config.
---

# Tech Versions: Svelte 5 + Tauri 2

**Always use Svelte 5 runes and Tauri 2 APIs. Never use older patterns unless you have explicit user approval.**

## Svelte 5 — Always Use Runes

### Reactive State

```svelte
<!-- ✅ Svelte 5 -->
<script lang="ts">
  let count = $state(0)
  let doubled = $derived(count * 2)

  $effect(() => {
    console.log('count changed:', count)
  })
</script>

<!-- ❌ Svelte 4 — NEVER use -->
<script lang="ts">
  let count = 0          // not reactive in Svelte 5 components
  $: doubled = count * 2 // reactive labels are gone
</script>
```

### Props

```svelte
<!-- ✅ Svelte 5 -->
<script lang="ts">
  let { name, onChange }: { name: string; onChange: (v: string) => void } = $props()
  let { value = $bindable() } = $props()
</script>

<!-- ❌ Svelte 4 — NEVER use -->
<script lang="ts">
  export let name: string        // export let is gone
  export let value: string       // use $bindable() instead
</script>
```

### Events

```svelte
<!-- ✅ Svelte 5 -->
<button onclick={() => doSomething()}>Click</button>
<input oninput={(e) => (value = e.currentTarget.value)} />

<!-- ❌ Svelte 4 — NEVER use -->
<button on:click={() => doSomething()}>Click</button>
<input on:input={(e) => (value = e.currentTarget.value)} />
```

### Component Events (replace createEventDispatcher)

```svelte
<!-- ✅ Svelte 5: use callback props -->
<script lang="ts">
  let { onselect }: { onselect: (id: string) => void } = $props()
</script>
<button onclick={() => onselect('foo')}>Select</button>

<!-- ❌ Svelte 4 — NEVER use -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
</script>
```

### Snippets (replace slots)

```svelte
<!-- ✅ Svelte 5 -->
{#snippet header(title: string)}
  <h1>{title}</h1>
{/snippet}
{@render header('Hello')}

<!-- ❌ Svelte 4 — NEVER use named slots -->
<slot name="header" />
```

## Tauri 2 — Always Use v2 APIs

### invoke

```typescript
// ✅ Tauri 2
import { invoke } from '@tauri-apps/api/core';

// ❌ Tauri 1 — NEVER use
import { invoke } from '@tauri-apps/api/tauri';
```

### Events

```typescript
// ✅ Tauri 2
import { listen, emit } from '@tauri-apps/api/event';

// ❌ Tauri 1 — NEVER use
import { listen } from '@tauri-apps/api';
```

### Window

```typescript
// ✅ Tauri 2
import { getCurrentWindow } from '@tauri-apps/api/window';

// ❌ Tauri 1 — NEVER use
import { appWindow } from '@tauri-apps/api/window';
```

## Tauri Commands — Rust + TS Pattern

```rust
// ✅ Tauri 2 — Rust command definition
#[tauri::command]
pub async fn search_apps(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AppResult>, String> {
    let index = state.index.read().await;
    Ok(index.search(&query))
}

// Register in lib.rs / main.rs
.invoke_handler(tauri::generate_handler![search_apps])
```

```typescript
// ✅ Frontend invoke — no logic, just dispatch
import { invoke } from '@tauri-apps/api/core';
const results = await invoke<AppResult[]>('search_apps', { query });
```

## Events Over Polling

**Never use `setInterval` or long-polling. Rust emits; Svelte listens.**

```rust
// ✅ Rust emits for continuous updates
app_handle.emit("indexing-progress", &IndexProgress { percent: 42 }).unwrap();
```

```svelte
<!-- ✅ Svelte 5 — listen in $effect, clean up on destroy -->
<script lang="ts">
  import { listen } from '@tauri-apps/api/event';

  let progress = $state(0);

  $effect(() => {
    const promise = listen<{ percent: number }>('indexing-progress', (e) => {
      progress = e.payload.percent;
    });
    return () => {
      promise.then((fn) => fn());
    };
  });
</script>

<!-- ❌ NEVER poll -->
<!-- setInterval(() => invoke('get_progress'), 500) -->
```

## Managed State — Rust Global State

```rust
// ✅ Tauri 2 — define and register managed state
pub struct AppState {
    pub index: Arc<RwLock<SearchIndex>>,
    pub config: Arc<Mutex<Config>>,
}

// In lib.rs / main.rs
.manage(AppState { index: ..., config: ... })
```

## State Sync — Rust Mutates → Svelte Reacts

```rust
// ✅ Rust: mutate state, then broadcast
let mut config = state.config.lock().await;
*config = new_config.clone();
app_handle.emit("config-updated", &new_config).unwrap();
```

```svelte
<!-- ✅ Svelte 5: catch event, update local $state -->
<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import type { Config } from '$lib/types';

  let config = $state<Config | null>(null);

  $effect(() => {
    const unlisten = listen<Config>('config-updated', (e) => {
      config = e.payload;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });
</script>
```

## SvelteKit — SPA / Static Build

```javascript
// svelte.config.js — always adapter-static, no SSR
import adapter from '@sveltejs/adapter-static';
export default { kit: { adapter: adapter() } };
```

```typescript
// src/routes/+layout.ts — disable SSR globally
export const ssr = false;
export const prerender = true;
```

## Quick Reference

| Concept            | ✅ Svelte 5                | ❌ Svelte 4 (banned)    |
| ------------------ | -------------------------- | ----------------------- |
| Reactive var       | `$state()`                 | reactive `let` / `$:`   |
| Computed           | `$derived()`               | `$: computed = ...`     |
| Side effects       | `$effect()`                | `$: { sideEffect() }`   |
| Props              | `$props()`                 | `export let`            |
| Two-way bind       | `$bindable()`              | `export let`            |
| Component events   | callback props             | `createEventDispatcher` |
| DOM events         | `onclick=`                 | `on:click=`             |
| Content projection | `{#snippet}` / `{@render}` | `<slot>`                |

| Concept | ✅ Tauri 2              | ❌ Tauri 1 (banned)     |
| ------- | ----------------------- | ----------------------- |
| invoke  | `@tauri-apps/api/core`  | `@tauri-apps/api/tauri` |
| events  | `@tauri-apps/api/event` | `@tauri-apps/api`       |
| window  | `getCurrentWindow()`    | `appWindow`             |

| Pattern            | ✅ Correct                           | ❌ Banned                        |
| ------------------ | ------------------------------------ | -------------------------------- |
| Continuous updates | `app_handle.emit(...)` + `listen()`  | `setInterval` / long-poll        |
| Global state       | `tauri::State<Mutex<T>>`             | Svelte store holding server data |
| State sync         | Rust emits event → `$effect` listens | Frontend polls Rust for state    |
| SPA mode           | `ssr = false`, `adapter-static`      | SSR enabled, `adapter-node`      |

## Common Mistakes

| Mistake                                 | Fix                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Using `export let` for props            | Switch to `let { prop } = $props()`                                            |
| Using `$:` reactive statements          | Use `$derived()` or `$effect()`                                                |
| Using `on:click` syntax                 | Use `onclick=` attribute syntax                                                |
| Importing from `@tauri-apps/api/tauri`  | Import from `@tauri-apps/api/core`                                             |
| Using `appWindow`                       | Use `getCurrentWindow()`                                                       |
| Using `createEventDispatcher`           | Use callback props via `$props()`                                              |
| Using `<slot>`                          | Use `{#snippet}` and `{@render}`                                               |
| Polling Rust for status (`setInterval`) | Rust emits event; Svelte listens via `listen()`                                |
| Storing server data in a Svelte store   | Keep in Rust managed state; only cache display state locally                   |
| Forgetting to unsubscribe `listen()`    | Return cleanup fn from `$effect`: `return () => { unlisten.then(fn => fn()) }` |
| SSR or adapter-node in SvelteKit        | Set `ssr = false` and use `adapter-static`                                     |

## Red Flags — STOP and Check Version

**Svelte / Tauri version violations:**

- Any `export let` in a `.svelte` file
- Any `$:` reactive label
- Any `on:` event directive
- Any `createEventDispatcher` import
- Any `import ... from '@tauri-apps/api/tauri'`
- Any `appWindow` reference
- Any `<slot>` element

**Architecture violations:**

- Any `setInterval` or `setTimeout` polling for Rust data
- Any Svelte store that holds server/index/config data (not just UI state)
- Any `$effect` that calls `invoke` on a timer
- Any `listen()` call without a cleanup return in `$effect`
- Any SvelteKit route with `ssr = true` or `adapter-node`

**All of these mean: you're using deprecated or banned patterns. Rewrite using the equivalents above.**
