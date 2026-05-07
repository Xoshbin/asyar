---
order: 10
---
# Dynamic Commands

Dynamic commands let a Tier 2 extension register commands at **runtime** —
in addition to the static commands declared in `manifest.json`. Each
dynamic command behaves identically to a manifest command at every
layer: it appears in root search, supports inline argument input on
Tab, ranks alongside manifest commands, and persists last-values for
its arguments.

The motivating use case is surfacing user-owned items from the operating
system: macOS Apple Shortcuts, SSH hosts in `~/.ssh/config`, project
paths, automation flows, scripts in user directories. The set of items
is unknown when the extension is built, so they cannot live in
`manifest.json` — the extension discovers them at runtime and registers
them through this API.

## When to use dynamic commands

Use dynamic commands when the **user's environment determines the
list** — the extension can't know in advance how many items there will
be or what they're called.

- macOS: each Apple Shortcut becomes one dynamic command
- All platforms: each entry in `~/.ssh/config` becomes one dynamic command
- All platforms: each script in a user-configured directory becomes one
  dynamic command
- Cross-platform automation: each Power Automate flow / Raycast Script /
  Alfred-style template becomes one dynamic command

For any list whose items are known at build time, prefer **manifest
commands** — they're simpler and don't need a worker to register.

For unbounded query-driven results (Linear tickets, Spotify tracks, web
search) where the user picks one and runs it, prefer the existing
`Extension.search()` API. Those results don't need typed argument
schemas.

## Worker-only

Dynamic commands must be registered from the extension's **worker
iframe**, never the view. The worker is always-on and survives the
panel closing; the view is on-demand and evicted (`Dormant`) within
roughly two minutes of the user dismissing the launcher. Registering
from the view would silently drop commands the moment the view is
evicted, leaving the user wondering why their items disappeared.

The SDK enforces this two ways:

1. The proxy method `commandsService.replaceDynamicCommands(...)`
   asserts `window.__ASYAR_ROLE__ === "worker"` before sending. Calling
   it from `view.ts` rejects with a clear error.
2. The launcher's Rust IPC handler rejects calls from extensions whose
   manifest does not declare `background.main`. An extension with no
   worker cannot register dynamic commands at all.

Both gates exist on purpose. The first catches honest mistakes early;
the second is the load-bearing security check.

## The API

```ts
import type { DynamicCommandRegistration, ICommandService } from 'asyar-sdk/contracts';
// ...inside your worker.ts
const commandsService = workerContext.getService<ICommandService>('commands');

const regs: DynamicCommandRegistration[] = [
  {
    id: 'sc-lights',          // stable identifier — see "Stable ids" below
    name: 'Set Lights',       // displayed in search results
    description: 'Smart-home command',
    icon: 'icon:lightbulb',
    arguments: [
      { name: 'value', type: 'text', placeholder: 'e.g. 85' },
    ],
  },
  // ...up to N items; no max enforced today, but expect ~5-100 in practice
];

await commandsService.replaceDynamicCommands(regs);
```

`replaceDynamicCommands` takes the **full current list**. There is no
`register` / `unregister` — every call is an atomic snapshot. The
launcher computes added / removed / kept internally and:

- removes search-index entries for ids no longer in the list
- adds search-index entries for new ids
- updates display fields (`name`, `description`, `icon`) for kept ids
- garbage-collects argument last-values for removed ids

If any registration fails validation, the call rejects and the previous
list remains intact. Validation is atomic — partial state is never
written.

## When to call it

The natural pattern is **on every change in the underlying source**:

- Apple Shortcuts: re-run `shortcuts list` from a `fs.watch` callback on
  `~/Library/Shortcuts/`.
- SSH hosts: re-parse `~/.ssh/config` from a `fs.watch` callback on it.
- Scripts in directories: re-read the directory from a `fs.watch`
  callback on the directory.

Plus once at activation:

```ts
async activate(): Promise<void> {
  await commandsService.replaceDynamicCommands(await computeCurrentList());
}
```

The activation call is the source of truth on launcher restart — the
launcher does not persist registry state between launches.

## Argument schemas

Same rules as manifest arguments:

- Maximum 3 arguments per command.
- `name` matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/`, unique within the command.
- Required arguments must precede optional arguments.
- `type` is one of `text`, `password`, `dropdown`, `number`.
- `dropdown` requires a non-empty `data: [{ value, title }, ...]`.
- When `default` is set, it must match the declared type.
- `password` values are never persisted.

See [Command Arguments](./command-arguments.md) for the full schema.

## Stable ids

The `id` field is the persistence key for argument last-values. If the
underlying source allows renaming (e.g., an Apple Shortcut's name is
editable, but its UUID is not), use the **stable identity** as `id`:

| Source | Recommended id |
|---|---|
| Apple Shortcut | the shortcut's UUID from `shortcuts list --show-identifiers` |
| SSH host | the `Host` line value (rarely renamed) |
| Script in directory | the file basename without extension |
| Project | absolute path hash, or workspace UUID if available |

The id format is `[a-zA-Z0-9_-]+`, max 128 characters. Colons and dots
are not allowed (the launcher reserves `:` for storage namespacing).

## Receiving arguments in the handler

Dynamic commands route through your extension's existing
`executeCommand` handler. The dynamic id arrives as the `commandId`;
argument values arrive under `args.arguments.<name>`:

```ts
async executeCommand(commandId: string, args?: CommandExecuteArgs) {
  if (commandId === 'sc-lights') {
    const value = String(args?.arguments?.value ?? '');
    // run the action with the user's value
  }
}
```

There is no separate dispatch source for dynamic commands; they reuse
the standard command path. This means scheduled-tick simulation,
deeplink trigger flags, and notification-action routing all work
identically — no parallel implementation to maintain.

## Lifecycle

| Event | Effect on dynamic commands |
|---|---|
| Extension activate | Worker boots, calls `replaceDynamicCommands` from your activate handler |
| Extension disable | Launcher drops registrations; persistence is **kept** so re-enable restores last-values |
| Extension uninstall | Launcher drops registrations and wipes all persisted last-values |
| Launcher restart | In-memory registry is fresh; your worker's activate path re-registers |

## Persistence

Argument last-values are stored in the launcher's SQLite
`command_arg_defaults` table, namespaced under
`(extension_id, "dynamic:<id>")` so dynamic ids can never collide with
manifest command ids.

A dynamic command sharing an id with a manifest command (within the
same extension) is supported and isolated — the persistence keys
differ by the `dynamic:` prefix the launcher applies internally.

## Cross-platform notes

The API itself is platform-neutral. Per-platform extensions should:

- Declare `platforms` in `manifest.json` to constrain installation.
- Use OS-native enumeration: `shortcuts list` on macOS, parsing
  `~/.ssh/config` on all Unix-likes, registry / API calls on Windows.
- Watch the underlying source with `fs.watch` (file-based) or polling
  (API-based) and re-call `replaceDynamicCommands` on each change.

The launcher core knows nothing about Apple Shortcuts, SSH, or any
specific platform feature — those concerns belong in the extension.

## Worked example: Apple Shortcuts

```ts
// extensions/apple-shortcuts/src/worker.ts
import { ExtensionContext as WorkerExtensionContext } from 'asyar-sdk/worker';
import type { ICommandService, IShellService, IFileSystemWatcherService } from 'asyar-sdk/contracts';

const ctx = new WorkerExtensionContext();
const commandsService = ctx.getService<ICommandService>('commands');
const shell = ctx.getService<IShellService>('shell');
const fsWatcher = ctx.getService<IFileSystemWatcherService>('fsWatcher');

async function listShortcuts() {
  const out = await shell.execute({
    command: '/usr/bin/shortcuts',
    args: ['list', '--show-identifiers'],
  });
  // parse `name (uuid)` lines into an array
  return out.stdout.split('\n').flatMap((line) => {
    const m = line.match(/^(.+?)\s+\((.+?)\)$/);
    return m ? [{ name: m[1], id: m[2] }] : [];
  });
}

async function syncFromOS() {
  const items = await listShortcuts();
  await commandsService.replaceDynamicCommands(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      arguments: [{ name: 'input', type: 'text', placeholder: 'Optional input' }],
    })),
  );
}

// Initial sync at activate, plus re-sync on every fs change.
await syncFromOS();
await fsWatcher.watch(['~/Library/Shortcuts/'], async () => {
  await syncFromOS();
});
```

## See also

- [Command Arguments](./command-arguments.md) — argument schema reference.
- [SDK · file-system-watcher](./sdk/file-system-watcher.md) — the natural
  invalidation signal for file-system-driven sources.
