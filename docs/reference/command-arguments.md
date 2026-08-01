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

| Field         | Type                                             | Required                     | Description                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                                         | ✅                           | Unique within the command. Regex: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. Becomes the key on `args.arguments`.                                                                                                                |
| `type`        | `"text" \| "password" \| "dropdown" \| "number"` | ✅                           | Input type. See [Type behaviour](#type-behaviour).                                                                                                                                                                  |
| `placeholder` | `string`                                         | ❌                           | Chip placeholder text shown when the field is empty.                                                                                                                                                                |
| `required`    | `boolean`                                        | ❌                           | Default `false`. Required arguments must be filled before `Enter` will submit, unless the argument also declares a `default`.                                                                                       |
| `default`     | `string \| number`                               | ❌                           | Value substituted when the field is left empty. Type must match the declared `type` (number default → number, everything else → string). For `dropdown`, must be one of `data[].value`, and pre-selects the option. |
| `data`        | `{ value, title }[]`                             | ❌ (required for `dropdown`) | Non-empty option list. Each option needs both `value` (returned) and `title` (displayed).                                                                                                                           |

#### Command-level `requireAnyOf`

Some commands need _some_ input without any single argument being the one that
must supply it. `caffeinate-for` wants an hours, a minutes or a seconds and
does not mind which. `required` cannot express that — marking all three
required would demand all three.

Declare the alternatives on the command instead:

```json
{
  "id": "caffeinate-for",
  "requireAnyOf": ["hours", "minutes", "seconds"],
  "arguments": [
    { "name": "hours", "type": "number", "default": 0 },
    { "name": "minutes", "type": "number", "default": 0 },
    { "name": "seconds", "type": "number", "default": 0 }
  ]
}
```

The two knobs then say different things: `requireAnyOf` is the **gate** (may
this run yet?), `default` is the **fill** (what goes in the blanks?). Enter with
`minutes` set to 30 runs the command with `{ hours: 0, minutes: 30, seconds: 0 }`;
Enter with nothing entered opens the chips and the bottom bar reads
_"Enter at least one of hours, minutes, seconds"_.

A **declared `default` never satisfies the gate.** Defaults fill blanks; they
are not the user asking for anything. Only a typed value, a selection restored
from an earlier Escape, or a remembered `dropdown` choice counts.

Validation rejects a group that names an argument the command does not declare,
lists one twice, has fewer than two members (use `required`), or names an
argument that is already `required`.

## Schema constraints

- **Max 3 arguments per command.** Chip-row real estate is finite; if you need more inputs, use a view.
- **Required arguments must precede optional ones.** The manifest validator rejects `required: true` that follows `required: false`.
- **Unique `name` per command.** Names collide only within a single command; two different commands may use the same name.

## How the user interacts with arguments

1. The user searches for your command in the launcher.
2. Highlighting it shows one greyed-out chip per declared argument, trailing
   the typed query. The chips are a preview: nothing is typed into them yet.
   With the query empty, the search bar shows the command's own name in
   placeholder grey instead of the usual prompt, and the chips trail that.
3. **Tab** (or a click on a chip) promotes the command into argument mode and
   focuses the first field. **Enter** does the same only when a `required`
   argument has nothing to stand in for it — no `default`, no stored last
   selection, nothing left from an earlier Escape. Optional arguments never
   hold Enter up: the command runs straight away, and Tab is how the user opts
   into filling them. It still receives everything those arguments declare or
   remember — a `default`, a stored `dropdown` selection — so the payload is
   the one argument mode would have sent, and anything with neither is simply
   absent. Handle those blanks accordingly.
4. **Tab / Shift+Tab** walk one ring over the search query and every field,
   selecting each field's contents on arrival. Tab off the last field lands
   back in the query; Shift+Tab off the first does the same. A command with a
   single argument therefore toggles between the query and its one field.
5. **Left / Right arrows** walk the same row, treating the search query as
   the slot to the left of the first field. Right steps out of a field only
   once the caret has reached its end; Left steps out immediately. A dropdown
   has no caret to cross, so one press leaves it either way — its own
   Up/Down keys are covered under
   [Dropdown interaction](#dropdown-interaction).
6. **Enter** submits when every required argument is filled, or has a
   `default` to fall back on. Required fields look the same as optional ones;
   `aria-required` carries the distinction for assistive tech. When Enter
   cannot run the command, the bottom bar's feedback area says why — next to
   where run failures appear. A value that cannot be parsed at all, such as
   text in a `number` field, is named as soon as it is typed; a merely
   unfilled required field is only reported once Enter has been pressed, and
   the message clears on the next edit.
7. **Escape**, or **Backspace on an empty first field**, exits argument mode
   without running the command. An open dropdown list takes Escape first. Whatever the user typed or picked stays in the
   chips for as long as the command remains highlighted, so Enter still runs it
   with those values. Untouched fields are not kept. Moving the highlight, or
   editing the query, discards everything — arrowing the result list while the
   chips are up therefore ends argument mode, since the chips describe the row
   that was highlighted when it started.

A `background` command closes the launcher once it dispatches. A `view`
command leaves it open, since its view has just mounted.

## Type behaviour

| Type       | Input widget                                  | Submitted as                                                            |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `text`     | Plain text input                              | `string`                                                                |
| `password` | Masked text input (asterisks)                 | `string`                                                                |
| `number`   | Text input, `inputmode="decimal"`, no stepper | `number` — parsed; submit is blocked if the value isn't a finite number |
| `dropdown` | Chip with a filterable list of `data[]`       | `string` — the chosen option's `value`                                  |

Dropdowns always submit one of the declared values. Numbers are coerced
before delivery, so your handler receives `7`, not `"7"`.

### Dropdown interaction

A dropdown chip shows the value it was seeded with — the last selection, or
the declared `default` — greyed, because the user has not weighed in on it
yet. Picking a value, even the same one, renders it in full.

- **Down / Up** walk the options with the list closed. Down from the seeded
  chip takes the first option; Up off the first option returns the chip to
  its seeded, greyed state. Neither end wraps.
- **Typing** opens the list on that keystroke, with what was typed in its
  search box and the options filtered by it. Deleting the query leaves the
  list open.
- **Click**, or **Space**, opens the list unfiltered and focuses its search
  box; clicking again closes it. The chevron follows.
- **Down / Up** move the highlight in an open list, and **Enter** takes it.
  The `-` row at the top, offered whenever the search box is empty, puts the
  chip back to its seeded state.
- **Escape** clears the search box, then closes the list on the next press.
  The chip keeps focus either way, so typing opens the list again; a third
  press leaves argument mode. **Backspace** clears a value the user picked.

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

## Persistence

Only `dropdown` selections carry over between invocations. After the user
submits, the chosen option is stored per `(extensionId, commandId)` in the
launcher's SQLite store and pre-selected next time, shown greyed until the
user picks something themselves.

`text`, `password`, and `number` fields start empty on every invocation,
showing their placeholder. Their `default`, if declared, is substituted at
submit time rather than typed into the field, so the user sees the hint
instead of a value they have to clear.

- `default` seeds a dropdown only when no selection has been stored yet.
- Uninstalling the extension clears its stored selections, along with its
  storage, preferences, and cache.

Persistence is transparent: extension authors don't opt in or out.

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

|             | Arguments                                         | Preferences                                                                                 |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Scope       | Per invocation                                    | Per install (extension or command)                                                          |
| UI          | Inline chip row in the search bar                 | Settings panel in Extensions tab                                                            |
| Persistence | `dropdown` selections only, per `(ext, cmd, arg)` | All values, encrypted-at-rest for `password`                                                |
| Max count   | 3 per command                                     | No fixed limit                                                                              |
| Types       | `text`, `password`, `dropdown`, `number`          | `textfield`, `password`, `dropdown`, `number`, `checkbox`, `appPicker`, `file`, `directory` |
| Reached as  | `args.arguments.<name>`                           | `context.preferences.<name>` / `context.preferences.commands.<cmdId>.<name>`                |

An extension can use both. Preferences configure defaults, API endpoints,
units — things the user sets once. Arguments capture the bits that change
every time the command runs.

## Manifest commands vs dynamic commands

The arguments described on this page apply to commands declared in
`manifest.json`. The same argument schema also applies to **dynamic
commands** registered at runtime — the launcher resolves both through
the same argument-mode pipeline, with one difference: dynamic command
selections are namespaced under `dynamic:<id>` in storage so dynamic
ids cannot collide with manifest ids.

For commands whose set is determined by the user's environment (Apple
Shortcuts, SSH hosts, scripts in directories), see
[Dynamic Commands](./dynamic-commands.md). For shell scripts specifically —
which declare their argument schema via `# @asyar.argument:N` comment
directives instead of a manifest entry — see
[Script Headers](./script-headers.md).
