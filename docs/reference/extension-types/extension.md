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

When the extension is enabled, Asyar materialises **two execution contexts** for it:

- A **headless Web Worker** — always-on while the extension is enabled,
  running `background.main` (`defineExtensionConfig` checks `worker.html`
  before `src/worker.ts` and selects it when both exist). Hosts long-lived work: push subscriptions, scheduled
  ticks, registered timers, tray-icon state writes, notification-action
  callbacks, and worker-side RPC handlers.
- A **view iframe** — on-demand, mounted when the user opens a `mode: "view"`
  command, evicted ~120 s after the last user interaction. Loads `view.html`
  (automatically generated from `src/view.ts` by `defineExtensionConfig`, or
  provided manually). Hosts UI rendering only.

Both contexts are sandboxed at `asyar-extension://<id>/` (macOS/Linux) or
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
  "version": "2.1.0",
  "description": "Focus timer with notifications.",
  "author": "Your Name",
  "icon": "🍅",
  "type": "extension",
  "asyarSdk": "^2.1.0",
  "background": { "main": "dist/worker.js" },
  "permissions": ["notifications:send", "timers:schedule", "timers:cancel"],
  "commands": [
    {
      "id": "open",
      "name": "Open Pomodoro",
      "mode": "view",
      "component": "PomodoroView",
      "icon": "🍅"
    },
    { "id": "start", "name": "Start Focus", "mode": "background", "icon": "▶️" },
    { "id": "stop", "name": "Stop Focus", "mode": "background" },
    { "id": "tick", "name": "Tick", "mode": "background", "schedule": { "intervalSeconds": 60 } }
  ]
}
```

Per-command rules:

- `mode: "view"` requires a non-empty `component` string. The value is the
  Svelte component your `view.ts` exports under that name.
- `mode: "background"` forbids `component`. The host dispatches the command
  to the worker via the SDK's `commands.onCommand(id, handler)` hook.
- At least one `mode: "background"` command (or a non-empty `searchable`
  contribution) requires `background.main` — the path to your compiled
  worker bundle relative to the package root.

For the full schema, see [`manifest.md`](../manifest.md).

## Worker entry — `src/worker.ts`

The worker bundle runs in a headless Web Worker (`background.main`).
For entry detection, `defineExtensionConfig` checks `worker.html` before
`src/worker.ts` and selects `worker.html` when both exist; `worker.html` is optional. It must import from
`asyar-sdk/worker`, never from `asyar-sdk/view` — the `/worker` entry asserts
`self.__ASYAR_ROLE__ === "worker"` at load time and exposes the worker-safe
proxy bag (no DOM-dependent helpers).

```typescript
import { ExtensionContext, extensionBridge } from 'asyar-sdk/worker';
import manifest from '../manifest.json';

const context = new ExtensionContext();
context.setExtensionId(manifest.id);
extensionBridge.registerManifest(manifest);

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
```

## View entry — `src/view.ts`

The view bundle imports from `asyar-sdk/view`, which asserts
`window.__ASYAR_ROLE__ === "view"` and exposes the full proxy bag plus DOM
helpers (icon custom element, theme injector, `onSearch`, `onKey`). Both
`view.html` and `worker.html` are optional — `defineExtensionConfig`
auto-detects `src/view.ts` and generates `view.html` automatically.

```typescript
import { ExtensionContext, extensionBridge, registerIconElement } from 'asyar-sdk/view';
import PomodoroView from './PomodoroView.svelte';
import { mount } from 'svelte';
import manifest from '../manifest.json';

registerIconElement();

const extensionId = manifest.id;
const context = new ExtensionContext();
context.setExtensionId(extensionId);
// `context.extensionId` returns the bound ID; `registerManifest` accepts JSON imports directly.
extensionBridge.registerManifest(manifest);
// Lifecycle methods (`initialize`, `activate`, `deactivate`, `onUnload`, `search`) are optional.
extensionBridge.registerExtensionImplementation(extensionId, {
  executeCommand: async (commandId, args) => {
    /* … */
  },
});

mount(PomodoroView, {
  target: document.getElementById('app')!,
  props: { context },
});
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

### Dismiss the launcher — `context.hideLauncher()`

From a **view**, `context.hideLauncher()` hides the launcher window — the same
effect as the user pressing the global toggle. Use it after an action that
should return the user to whatever they were doing (a kill confirmed, a file
opened, a command fired) rather than leaving the launcher floating.

```svelte
<script lang="ts">
  import type { ExtensionContext } from 'asyar-sdk/view';
  let { context }: { context: ExtensionContext } = $props();

  async function killAndDismiss(pids: number[]) {
    await context.getService<IProcessService>('process').kill({ pids, force: false });
    context.hideLauncher(); // get out of the user's way
  }
</script>
```

It is **synchronous, fire-and-forget, and ungated** — no permission, no
return value. Under the hood it posts `asyar:window:hide` to the host frame;
calling it outside a view iframe is a no-op.

## Searchable extensions

`searchable: true` at the root makes the launcher forward global search
queries to your extension. With the worker/view split, the recommended home
for `search()` is the **worker** — it stays mounted while the user types, so
results are instant. Register the search handler in `src/worker.ts`:

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
