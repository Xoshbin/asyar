---
order: 10
---
# Search Bar Accessory

A search bar accessory is a dropdown the launcher renders in the
top-right of the search bar while a view-mode command is active. The
user picks from a list of options; the extension reacts to the selection
to filter or re-fetch its content. Selections persist per-command across
launches.

## When to use a search bar accessory

Use an accessory when an active view has one discrete dimension the user
will switch between repeatedly:

- Filter a clipboard history view by content type (text / image / file)
- Pick a Hacker News section (Front Page / Best / Jobs / Launches)
- Filter a docs browser by section (Getting Started / Plugins / Reference)
- Choose a project for a TODO list view

Prefer **preferences** for per-install configuration (API keys, defaults)
— they persist and apply to every invocation. Prefer **command
arguments** when the input must be collected *before* the view opens, or
when you need free-form text or numeric input. Use the accessory when
the view is already on screen and the user is switching between a small,
known set of options.

## Constraints

- **View-mode only** (`mode: "view"`). Background commands and searchable
  extensions whose results merge into global search are not supported.
  The Rust manifest validator rejects accessories on non-view commands at
  install time.
- **One accessory per command.** There is no "multiple dropdowns" mode.
- **`type: "dropdown"` only in v1.** The discriminator field reserves
  room for future types.

## Declaring an accessory

Add a `searchBarAccessory` object to a view-mode command in
`manifest.json`:

```json
{
  "id": "show",
  "name": "Show",
  "mode": "view",
  "component": "MyView",
  "searchBarAccessory": {
    "type": "dropdown",
    "default": "all",
    "options": [
      { "value": "all",    "title": "All Types" },
      { "value": "text",   "title": "Text" },
      { "value": "images", "title": "Images" },
      { "value": "files",  "title": "Files" }
    ]
  }
}
```

### Per-field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"dropdown"` | ✅ | Discriminator. Only `"dropdown"` in v1; reserves room for future types. |
| `options` | `{ value, title }[]` | ✅ | Non-empty list. `value` is what the extension receives; `title` is what the user sees. Both must be strings. |
| `default` | `string` | ❌ | Pre-selected value on first invocation. Must be one of `options[].value`. If omitted, the first option is the default. |

### Schema constraints

- `options` must be a non-empty array.
- Every option must have string `value` and `title` fields.
- `default` (when present) must equal one of `options[].value`.
- The accessory is only valid on commands with `mode: "view"`. Mixing it
  with `mode: "background"` is a parse error.
- Validated by both the SDK CLI's manifest parser at build time and the
  Rust parser at install time.

## How the user interacts with the accessory

1. The user activates the view-mode command.
2. The dropdown appears in the top-right of the search bar with the
   current selection visible.
3. **⌘P** (Cmd+P / Ctrl+P) opens the popover.
4. A filter input at the top of the popover lets the user narrow options
   by typing — substring match on the option's `title`.
5. **Arrow keys** navigate the (filtered) options. **Enter** selects.
   **Escape** closes the popover and refocuses the trigger button.
   **Tab** closes.
6. Clicking the trigger button toggles the popover.

## SDK API

The view bag exposes a `searchBarAccessory` singleton with three methods.
Import it from `asyar-sdk/view` — the worker bag does not include it,
and a misimport from `asyar-sdk/worker` fails at module load.

### `onChange(handler): () => void`

Fires once on view mount with the seed value (persisted, then manifest
`default`, then the first option), and on every user pick or programmatic
`set({ value })`.

```typescript
import { searchBarAccessory } from "asyar-sdk/view";

const off = searchBarAccessory.onChange((value) => {
  // re-filter or re-fetch your view's content
});
```

The returned disposer should be called on view teardown.

### `set(opts): Promise<void>`

Two use cases:

1. **Replace the option list at runtime** — when the manifest cannot know
   the options ahead of time (user-defined tags, dynamically-fetched
   categories):

   ```typescript
   await searchBarAccessory.set({
     options: [
       { value: "front",    title: "Front Page" },
       { value: "best",     title: "Best" },
       { value: "comments", title: "Best Comments" },
     ],
   });
   ```

2. **Programmatically select an option** — also fires `onChange`
   handlers:

   ```typescript
   await searchBarAccessory.set({ value: "best" });
   ```

Both fields are optional; you can pass either, both, or call `set({})`
as a no-op.

### `clear(): Promise<void>`

Drop the accessory from the launcher chrome mid-session. Rare — most
extensions never call this; the launcher auto-clears when the view
unmounts.

```typescript
await searchBarAccessory.clear();
```

`clear()` removes the dropdown from the chrome but does not delete the
persisted value — the next view mount still seeds with the last
selection.

## Persistence

The launcher persists the selected value per `(extensionId, commandId)`
in a SQLite store, separate from preferences. On view re-mount,
`onChange` fires with the previously-selected value rather than the
manifest `default`.

The persisted value is cleared automatically when the extension is
uninstalled, alongside its storage, preferences, and cache.

## Tier 1 vs Tier 2

For Tier 2 extensions (the typical case): `import { searchBarAccessory }
from "asyar-sdk/view"` and use `onChange` / `set` / `clear` as
documented above.

For Tier 1 built-in features: same conceptual API, but consume the
launcher's `searchBarAccessoryService` singleton directly via
`subscribe(extensionId, commandId, handler)`. The clipboard-history
built-in is the reference consumer — see
[`built-in-features/clipboard-history/`](../../src/built-in-features/clipboard-history/)
for an example.

## Manifest mode rule

A command may declare both `arguments` (chip-row inputs collected before
the command runs) and `searchBarAccessory` (dropdown shown after the
view mounts) — they are orthogonal. Argument mode commandeers the search
bar visually before the view opens; the accessory takes over the right
slot once the view is up.

## Relationship to other features

| | Search bar accessory | Arguments | Preferences |
|---|---|---|---|
| Scope | Per view session | Per invocation | Per install |
| UI | Top-right dropdown in search bar | Inline chip row in search bar | Settings panel |
| When shown | After view-mode command activates | Before any command runs (Tab) | Settings tab |
| Persistence | Last value per `(ext, cmd)` | Last value per `(ext, cmd, arg)` | All values |
| Max count | 1 per command | 3 per command | No limit |
| Reached via | `searchBarAccessory.onChange` | `args.arguments.<name>` | `context.preferences` |

## Delivery guarantees

For Tier 2 extensions, filter-change pushes flow through the same
view-iframe channel as `view:search` and other host→view events. If the
view iframe is unmounted (e.g., the user dismissed the panel), the push
is silently dropped — the next view mount re-seeds via `onChange` with
the persisted value.

For Tier 1 (built-in) commands, subscriptions are direct in-process
function calls with no iframe involved.

## Validation at build time

The SDK CLI's `asyar build` validates the manifest shape — empty
options, default-not-in-options, and accessory on a non-view command all
fail before the extension can ship. Run validation explicitly with
`asyar validate`. See [CLI reference](./cli.md).
