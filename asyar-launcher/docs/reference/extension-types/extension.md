---
order: 1
---
### Type 1: Extension (`type: "extension"`)

Asyar has a single Tier 2 extension type. The pre-split distinction between
"view", "result", and "logic" is gone. Every extension declares
`type: "extension"` (or omits it — `"extension"` is the default), and each
**command** independently picks `mode: "view"` (opens a panel) or
`mode: "background"` (runs headless in the worker iframe). One extension can
mix both freely.

**Use this type when:** you want to surface anything other than a pure CSS
theme — a search engine over your data, a UI panel, a headless background
worker, a tray icon, a scheduled tick, or any combination thereof. The only
other type is [`theme`](./theme.md).

## How it works

When the extension is enabled, Asyar materialises **two iframes** for it:

- A **worker iframe** — hidden, always-on while the extension is enabled,
  loads `worker.html`. Hosts long-lived work: push subscriptions, scheduled
  ticks, registered timers, tray-icon state writes, notification-action
  callbacks, and worker-side RPC handlers.
- A **view iframe** — on-demand, mounted when the user opens a `mode: "view"`
  command, evicted ~120 s after the last user interaction. Loads `view.html`.
  Hosts UI rendering only.

Both iframes are sandboxed at `asyar-extension://<id>/` (macOS/Linux) or
`http://asyar-extension.localhost/<id>/` (Windows). They communicate with
each other through a launcher-brokered state mailbox and an RPC primitive.

For the lifecycle state machine, mailbox semantics, and the view↔worker RPC
protocol, see the [extension runtime explanation](../../explanation/extension-runtime.md).

## Manifest template

A pomodoro-style extension that exercises both contexts:

```json
{
  "id": "com.yourname.pomodoro",
  "name": "Pomodoro",
  "version": "2.0.0",
  "description": "Focus timer with notifications.",
  "author": "Your Name",
  "icon": "🍅",
  "type": "extension",
  "asyarSdk": "^2.0.0",
  "background": { "main": "dist/worker.js" },
  "permissions": ["notifications:send", "timers:schedule", "timers:cancel"],
  "commands": [
    { "id": "open",  "name": "Open Pomodoro", "mode": "view", "component": "PomodoroView", "icon": "🍅" },
    { "id": "start", "name": "Start Focus",   "mode": "background", "icon": "▶️" },
    { "id": "stop",  "name": "Stop Focus",    "mode": "background" },
    { "id": "tick",  "name": "Tick",          "mode": "background", "schedule": { "intervalSeconds": 60 } }
  ]
}
```

Per-command rules:
- `mode: "view"` requires a non-empty `component` string. The value is the
  Svelte component your `view.ts` exports under that name.
- `mode: "background"` forbids `component`. The host dispatches the command
  to the worker iframe via the SDK's `commands.onCommand(id, handler)` hook.
- At least one `mode: "background"` command (or a non-empty `searchable`
  contribution) requires `background.main` — the path to your compiled
  worker bundle relative to the package root.

For the full schema, see [`manifest.md`](../manifest.md).

## Worker entry — `src/main.worker.ts`

The worker bundle runs as a hidden iframe. It must import from
`asyar-sdk/worker`, never from `asyar-sdk/view` — the `/worker` entry asserts
`window.__ASYAR_ROLE__ === "worker"` at load time and exposes the
worker-safe proxy bag (no DOM-dependent helpers).

```typescript
import { ExtensionContext, extensionBridge } from 'asyar-sdk/worker';

const extensionId = window.location.hostname || 'com.yourname.pomodoro';
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Dispatcher entry — fired for every `mode: "background"` command.
context.commands.onCommand('start', async () => {
  await context.proxies.timers!.schedule({ id: 'pomodoro:end', delaySeconds: 25 * 60 });
  await context.state.set('phase', 'focus');
});

context.commands.onCommand('stop', async () => {
  await context.proxies.timers!.cancel('pomodoro:end');
  await context.state.set('phase', 'idle');
});

context.commands.onCommand('tick', async () => {
  // Scheduled every 60 s — update the tray label, push state to the view, etc.
});

// view → worker RPC handler. The view's `context.request('getStats', ...)`
// arrives here.
context.onRequest<{}, { rounds: number }>('getStats', async () => {
  return { rounds: (await context.state.get<number>('rounds')) ?? 0 };
});

window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'worker' }, '*');
```

## View entry — `src/main.view.ts`

The view bundle imports from `asyar-sdk/view`, which asserts
`window.__ASYAR_ROLE__ === "view"` and exposes the full proxy bag plus DOM
helpers (icon custom element, theme injector).

```typescript
import { ExtensionContext, extensionBridge, registerIconElement } from 'asyar-sdk/view';
import PomodoroView from './PomodoroView.svelte';
import { mount } from 'svelte';

registerIconElement();

const extensionId = window.location.hostname || 'com.yourname.pomodoro';
const context = new ExtensionContext();
context.setExtensionId(extensionId);
extensionBridge.registerManifest(manifest);
extensionBridge.registerExtensionImplementation(extensionId, { /* … */ });

mount(PomodoroView, {
  target: document.getElementById('app')!,
  props: { context },
});

window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'view' }, '*');
```

Inside the view component, call worker handlers with `context.request`:

```svelte
<script lang="ts">
  import type { ExtensionContext } from 'asyar-sdk/view';
  let { context }: { context: ExtensionContext } = $props();
  let stats = $state<{ rounds: number } | null>(null);

  $effect(async () => {
    stats = await context.request<{}, { rounds: number }>('getStats', {});
  });
</script>
```

## Searchable extensions

`searchable: true` at the root makes the launcher forward global search
queries to your extension. With the worker/view split, the recommended home
for `search()` is the **worker** — it stays mounted while the user types, so
results are instant. Register the search handler in `main.worker.ts`:

```typescript
import { ExtensionContext, extensionBridge } from 'asyar-sdk/worker';

extensionBridge.registerExtensionImplementation(extensionId, {
  async search(query: string) {
    // your search logic
    return [/* ExtensionResult[] */];
  },
  // … other Extension methods
});
```

Selecting a result with `viewPath` set navigates the launcher to that view —
the host mounts the view iframe on demand. The `action` closure is still
ignored across the iframe boundary; control navigation via `viewPath`.

## When NOT to need a worker

If every command is `mode: "view"` and you have no push subscriptions, no
scheduled ticks, no tray items, and no notification-action callbacks, you
can omit `background.main` entirely. The extension will load with a view
iframe only. The `searchable` flag also requires a worker — searchable
extensions must declare `background.main`.

## See also

- [Manifest reference](../manifest.md) — full schema with validation rules.
- [Extension runtime](../../explanation/extension-runtime.md) — state
  machine, mailbox, RPC, state broker.
- [IPC bridge](../../explanation/ipc-bridge.md) — postMessage routing,
  permission gate, push events.
- [In-view search](./in-view-search.md) — handling the global search bar
  while a view is open.
- [Theme extensions](./theme.md) — the only other top-level type.
