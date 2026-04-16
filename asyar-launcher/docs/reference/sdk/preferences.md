# Preferences

Extensions declare typed preferences in their `manifest.json`. The launcher auto-generates a settings UI in the Extensions settings tab and populates `context.preferences` at extension boot with a unified object that provides synchronous snapshot reads and async mutation methods.

## Declaring Preferences

Preferences live at two scopes:

- **Extension level** — apply to all commands.
- **Command level** — apply only to one command.

At runtime a command sees the union: command-scoped keys shadow extension-scoped ones with the same name.

```jsonc
{
  "id": "org.example.weather",
  "preferences": [
    {
      "name": "apiKey",
      "type": "password",
      "title": "OpenWeather API Key",
      "description": "Get one at openweathermap.org/api",
      "required": true
    },
    {
      "name": "units",
      "type": "dropdown",
      "title": "Temperature Units",
      "default": "metric",
      "data": [
        { "value": "metric", "title": "Celsius" },
        { "value": "imperial", "title": "Fahrenheit" }
      ]
    }
  ],
  "commands": [
    {
      "id": "forecast",
      "name": "Show Forecast",
      "description": "Show the 5-day forecast",
      "preferences": [
        {
          "name": "days",
          "type": "number",
          "title": "Forecast days",
          "default": 5
        }
      ]
    }
  ]
}
```

## Supported Types

| Type        | Value type      | Rendered as             |
|-------------|-----------------|-------------------------|
| `textfield` | `string`        | Text input              |
| `password`  | `string`        | Password input          |
| `number`    | `number`        | Number input            |
| `checkbox`  | `boolean`       | Checkbox                |
| `dropdown`  | `string`        | Segmented control       |
| `appPicker` | `string` (path) | Text input *            |
| `file`      | `string` (path) | Text input *            |
| `directory` | `string` (path) | Text input *            |

\* Native picker UIs for `appPicker`, `file`, and `directory` are deferred. They currently accept manual path entry.

## Declaration Shape

```ts
interface PreferenceDeclaration {
  /** Unique key. Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. */
  name: string;
  type: PreferenceType;
  /** UI label. Required. */
  title: string;
  /** UI hint shown below the label. */
  description?: string;
  /** If true, commands cannot execute until the user sets a value. */
  required?: boolean;
  /** Default value used until the user saves a value. */
  default?: string | number | boolean;
  /** Placeholder text for textfield / number / password. */
  placeholder?: string;
  /** Options for dropdown type. Required when type === 'dropdown'. */
  data?: { value: string; title: string }[];
}
```

## Required Preferences

Preferences marked `required: true` block command execution until the user sets a value. When the user triggers a command whose extension still has required preferences unset:

1. The launcher opens a blocking modal listing only the missing required preferences.
2. **Save & Continue** — persists the values and resumes the original command.
3. **Cancel** — closes the modal, does not run the command.

Scheduled command ticks (via `schedule.intervalSeconds`) bypass the gate — there is no user to prompt.

A `required: true` preference combined with a `default` is effectively optional because the default satisfies the gate.

## Reading Values at Runtime

`context.preferences` is an instance of `PreferencesFacade` — a unified object that composes the cached snapshot with async mutation methods. It has the following shape:

```ts
context.preferences = {
  values: PreferencesSnapshot       // frozen, synchronous read
  set(scope, key, value): Promise<void>
  reset(scope): Promise<void>
  refresh(): Promise<PreferencesSnapshot>
}
```

Where `PreferencesSnapshot` is:

```ts
interface PreferencesSnapshot {
  [key: string]: unknown
  commands: { [commandId: string]: { [key: string]: unknown } }
}
```

Read preference values synchronously from `context.preferences.values`:

```ts
export default {
  async initialize(context: ExtensionContext) {
    const apiKey = context.preferences.values.apiKey as string | undefined;
    const units = context.preferences.values.units as string;
    const days = context.preferences.values.commands['forecast']?.days as number;
    // ...
  },
};
```

- `context.preferences.values` is a **frozen snapshot** taken at extension boot.
- Extension-level preferences appear as flat keys on `context.preferences.values`.
- Command-level preferences appear under `context.preferences.values.commands[commandId]`.
- The snapshot is frozen at every nesting level — attempting to mutate it throws in strict mode.

### Mutating Values

Use `context.preferences.set(scope, key, value)` to persist a single preference. `scope` is either `'extension'` for an extension-level preference or the command id for a command-level preference:

```ts
await context.preferences.set('extension', 'apiKey', 'sk-…')
await context.preferences.set('my-command', 'focusMinutes', 25)
```

Use `context.preferences.reset(scope)` to clear all preferences for a given scope back to their manifest defaults. `scope` is required and resets only the named scope:

```ts
await context.preferences.reset('extension')      // resets extension-scope only
await context.preferences.reset('my-command')     // resets one command's scope only
```

Use `context.preferences.refresh()` to pull the current snapshot from the host on demand, returning the fresh `PreferencesSnapshot`:

```ts
const fresh = await context.preferences.refresh()
```

### Updates and Propagation

When the user edits a preference in Settings, or after any `set()` or `reset()` call resolves, the launcher pushes a fresh snapshot to the extension — by the time your `await` resolves, `context.preferences.values` has already been updated with the new snapshot. No manual `refresh()` needed. The launcher guarantees this ordering: it posts the fresh snapshot back to the extension before posting the invoke response, so the update is visible the moment the mutation call returns:

```ts
await context.preferences.set('extension', 'theme', 'dark')
context.preferences.values.theme  // → 'dark' (already updated)
```

- **Tier 1 (built-in) features** are fully reloaded — their `initialize()` runs again with a fresh `context`.
- **Tier 2 (sandboxed iframe) extensions** receive an `asyar:event:preferences:set-all` postMessage. The SDK replaces `context.preferences.values` with a new frozen snapshot and then fires any registered `onPreferencesChanged` listeners.

> The message type lives under the `asyar:event:*` namespace because the SDK's `MessageBroker` only routes messages with that prefix to registered listeners. A plain `asyar:preferences:set-all` would be dropped at the routing switch.

Extensions should **not** cache `context.preferences.values` entries into long-lived module state unless they also subscribe to `context.onPreferencesChanged` to recompute when values change.

### How the bundle reaches the live context (Tier 2)

Tier 2 extensions typically bootstrap by creating a context directly in `main.ts`:

```ts
const context = new ExtensionContext();
context.setExtensionId(extensionId);
// ... use services via context.getService(...) or context.proxies
```

That `setExtensionId` call also **self-registers** the context with the iframe's `ExtensionBridge` singleton. Without that step, the bridge's preference listener would have no handle on the live context and would drop incoming `asyar:event:preferences:set-all` messages silently. You do not need to do anything extra — just call `setExtensionId` as usual.

If the launcher replies with the initial preferences bundle **before** your `main.ts` has constructed the context (a race condition during async bootstrap), the bridge stashes the bundle under an internal sentinel key and drains it on the next `setExtensionId` call. Either way, your context ends up with the correct preferences by the time any `initialize()` or view-mount code runs.

### Subscribing to changes

Extensions that need to react to preference edits — for example, a timer that derives its duration from `focusMinutes` — can subscribe to change notifications. **Tier 2 (sandboxed iframe) extensions** use the `context.onPreferencesChanged()` method:

```ts
import type { ExtensionContext } from 'asyar-sdk';

let focusSeconds = 25 * 60;

export function init(context: ExtensionContext) {
  // Cache at boot.
  focusSeconds = (context.preferences.values.focusMinutes as number) * 60;

  // Recompute whenever the user edits preferences. The callback takes no
  // arguments — always re-read from context.preferences.values, which already
  // holds the fresh frozen snapshot by the time the callback fires.
  const unsubscribe = context.onPreferencesChanged(() => {
    focusSeconds = (context.preferences.values.focusMinutes as number) * 60;
  });

  return () => unsubscribe();
}
```

The callback is read-only: it receives no arguments and cannot mutate the snapshot. `context.preferences.values` is frozen at every nesting level. The callback fires *after* the new snapshot is installed, so the first `context.preferences.values.<key>` read inside it always returns the new value.

For simple cases that don't cache values — where the extension reads `context.preferences.values.<key>` on each use — no subscription is needed. Later reads automatically see the new snapshot.

**Tier 1 (built-in) extensions** do not use `context.onPreferencesChanged()`. Instead, the extension is fully reloaded when preferences change — `initialize()` runs again with a fresh `context` containing the new `context.preferences.values`. No subscription is needed; each new instance reads the updated snapshot at boot.

## Encryption at Rest

Values of type `password` are encrypted with AES-256-GCM using a device-local key and stored in the launcher's SQLite database. Plaintext is only materialised when the launcher decrypts on read to inject into the extension runtime.

## Cloud Sync

Non-password preferences sync across devices via the `ExtensionPreferencesSyncProvider` in the Profile Sync system. Password-type values are excluded at the Rust query layer (`WHERE is_encrypted = 0`) and never leave the device — users re-enter API keys per machine.

Sync conflict resolution is controlled from the Profile settings tab. Default strategy for preferences is `replace`.

## Validation

Manifest validation runs at two layers:

1. **SDK CLI** (`asyar build` / `asyar validate`) — catches schema errors at publish time.
2. **Rust discovery** — re-validates on every launcher boot. Invalid preference declarations fail the whole extension load (fail-loud).

Rules:

- `name` must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
- `title` is required.
- `dropdown` requires a non-empty `data` array; if `default` is set, it must be a value in `data[]`.
- `number` default must be a finite number.
- `checkbox` default must be a boolean.
- No duplicate `name` within the same scope.

## Reset to Defaults

Each extension's preferences panel has a "Reset to defaults" button. It clears all preference rows (including encrypted password values) for that extension in one transaction. The next read falls back to manifest defaults; required-password preferences will re-trigger the first-run modal on the next command invocation.

## No New Permission

Preferences do not require a manifest permission. The declaration in `manifest.json` is itself the authorization — an extension can only read/write the preferences it declared, and values are auto-scoped by `extension_id` at the database layer.
