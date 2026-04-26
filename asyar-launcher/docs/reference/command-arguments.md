---
order: 9
---
# Command Arguments

Command arguments let a command declare structured input fields that the
launcher collects inline — as a chip row in the search bar — **before**
running the command. Values arrive in the command handler under
`args.arguments.<name>`.

## When to use command arguments

Use arguments when a command always needs short, typed inputs to run:

- Translate text (`text`, `target language`)
- Greet someone (`name`, `style`, `volume`)
- Schedule a reminder (`minutes`, `label`)
- Search an API (`query`)

Prefer **preferences** for per-install configuration (API keys, defaults, UI
options) — they persist and apply to every invocation. Prefer **a view**
when the input is longer-form, multi-step, or needs real-time feedback
while the user types.

## Declaring arguments

Add an `arguments` array to a command in `manifest.json`:

```json
{
  "id": "translate",
  "name": "Translate",
  "mode": "background",
  "arguments": [
    {
      "name": "text",
      "type": "text",
      "placeholder": "Text to translate",
      "required": true
    },
    {
      "name": "target",
      "type": "dropdown",
      "placeholder": "Language",
      "default": "es",
      "data": [
        { "value": "es", "title": "Spanish" },
        { "value": "fr", "title": "French" },
        { "value": "de", "title": "German" }
      ]
    }
  ]
}
```

### Per-argument fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Unique within the command. Regex: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. Becomes the key on `args.arguments`. |
| `type` | `"text" \| "password" \| "dropdown" \| "number"` | ✅ | Input type. See [Type behaviour](#type-behaviour). |
| `placeholder` | `string` | ❌ | Chip placeholder text shown when the field is empty. |
| `required` | `boolean` | ❌ | Default `false`. Required arguments must be filled before `Enter` will submit. |
| `default` | `string \| number` | ❌ | Pre-filled value on first invocation. Type must match the declared `type` (number default → number, everything else → string). For `dropdown`, must be one of `data[].value`. |
| `data` | `{ value, title }[]` | ❌ (required for `dropdown`) | Non-empty option list. Each option needs both `value` (returned) and `title` (displayed). |

### Schema constraints

- **Max 3 arguments per command.** Chip-row real estate is finite; if you need more inputs, use a view.
- **Required arguments must precede optional ones.** The manifest validator rejects `required: true` that follows `required: false`.
- **Unique `name` per command.** Names collide only within a single command; two different commands may use the same name.

## How the user interacts with arguments

1. The user searches for your command in the launcher.
2. With the command highlighted, they press **Tab** (or **Enter** when the
   command has at least one `required` argument — the launcher auto-enters
   argument mode instead of executing).
3. The command becomes a chip; its arguments render as inline inputs in the
   search bar. Focus lands on the first field.
4. **Tab / Shift+Tab** move between fields. **Shift+Tab on the first field**
   exits argument mode back to search.
5. **Enter** submits when every required argument is filled. A red `*`
   marks required fields visually.
6. **Escape**, or **Backspace on an empty first field**, exits argument
   mode without running the command.

## Type behaviour

| Type | Input widget | Submitted as |
|---|---|---|
| `text` | Plain text input | `string` |
| `password` | Masked text input (asterisks) | `string` |
| `number` | Numeric input (`inputmode="decimal"`) | `number` — parsed; submit is blocked if the value isn't a finite number |
| `dropdown` | Native `<select>` of `data[]` options | `string` — the chosen option's `value` |

Dropdowns always submit one of the declared values. Numbers are coerced
before delivery, so your handler receives `7`, not `"7"`.

## Receiving arguments in your handler

Collected values arrive under an `arguments` key on the args object the
host passes to `executeCommand(commandId, args)`:

```typescript
// Tier 2 extension (iframe sandbox)
class MyExtension implements Extension {
  async executeCommand(commandId: string, args?: CommandExecuteArgs) {
    if (commandId === 'translate') {
      const a = args?.arguments ?? {};
      const text = String(a.text ?? '');
      const target = String(a.target ?? 'es');
      // ... call the translation API ...
    }
  }
}
```

```typescript
// Tier 1 built-in feature
async executeCommand(commandId: string, args?: CommandExecuteArgs) {
  if (commandId === 'greet') {
    const nested = args?.arguments ?? {};
    const name = String(nested.name ?? 'stranger');
    // ...
  }
}
```

Other keys alongside `arguments` remain the established system flags —
`scheduledTick`, `deeplinkTrigger`. They are never mixed with user-declared
argument values.

## Persistence — last-value pre-fill

After the user submits, the launcher stores the non-password values per
`(extensionId, commandId)` in the launcher's SQLite store. The next time
the user opens argument mode for the same command, those values pre-fill
the chip row. The user can edit them freely before submitting again.

- `password` fields are **never** persisted. They start empty on every
  invocation.
- `default` from the manifest is used only when no persisted value exists
  for that field yet.
- Uninstalling the extension clears its persisted argument defaults, along
  with its storage, preferences, and cache.

Persistence is transparent — extension authors don't opt in or out. If you
want a field to start empty every time, declare it as `password` (when
appropriate) or don't give it a `default`.

## Scheduled, deeplink, and notification-triggered invocations

Arguments are a **user-interaction** feature. When a command runs without a
user at the keyboard — a scheduled tick, a deeplink URL, a notification
action click — no argument-entry UI is shown. Your handler receives
whatever `arguments` the caller provided (usually none) and must cope with
missing values.

For deeplink arguments, see [Deeplink triggering](./deeplink-triggering.md).

## Delivery guarantees

Argument-mode submissions for Tier 2 extensions flow through the same
lifecycle registry as every other `asyar:command:execute` delivery. If the
extension's iframe is dormant when the user hits Enter, the host mounts
it on demand, queues the message, and delivers it once the iframe signals
ready. You do not need to keep the iframe alive — the launcher handles it.

Submissions for Tier 1 (built-in) commands are a direct JS call with no
iframe involved.

## Relationship to preferences

| | Arguments | Preferences |
|---|---|---|
| Scope | Per invocation | Per install (extension or command) |
| UI | Inline chip row in the search bar | Settings panel in Extensions tab |
| Persistence | Last-value per `(ext, cmd, arg)`, except `password` | All values, encrypted-at-rest for `password` |
| Max count | 3 per command | No fixed limit |
| Types | `text`, `password`, `dropdown`, `number` | `textfield`, `password`, `dropdown`, `number`, `checkbox`, `appPicker`, `file`, `directory` |
| Reached as | `args.arguments.<name>` | `context.preferences.<name>` / `context.preferences.commands.<cmdId>.<name>` |

An extension can use both. Preferences configure defaults, API endpoints,
units — things the user sets once. Arguments capture the bits that change
every time the command runs.
