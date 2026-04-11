# Preferences

Extensions declare typed preferences in their `manifest.json`. The launcher auto-generates a settings UI in the Extensions settings tab and injects a frozen snapshot of preference values into `context.preferences` at extension boot.

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

Extensions read preference values synchronously from `context.preferences`:

```ts
export default {
  async initialize(context: ExtensionContext) {
    const apiKey = context.preferences.apiKey as string | undefined;
    const units = context.preferences.units as string;
    const days = context.preferences.commands.forecast?.days as number;
    // ...
  },
};
```

- `context.preferences` is a **frozen snapshot** taken at extension boot.
- Extension-level preferences appear as flat keys on `context.preferences`.
- Command-level preferences appear under `context.preferences.commands[commandId]`.
- The snapshot is frozen at every nesting level — attempting to mutate it throws in strict mode.

### Updates

When the user edits a preference in Settings, the launcher re-delivers the fresh snapshot:

- **Tier 1 (built-in) features** are fully reloaded — their `initialize()` runs again with a fresh `context`.
- **Tier 2 (sandboxed iframe) extensions** receive an `asyar:preferences:set-all` postMessage that updates `context.preferences` in place (still frozen).

Extensions should **not** cache `context.preferences` values into long-lived module state — always read them fresh from the context where possible.

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
