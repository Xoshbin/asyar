---
order: 11
---
# Script Headers

Asyar scans user-configured directories for executable script files and
registers each one as a [dynamic command](./dynamic-commands.md). The script
file's metadata — title, icon, argument schema, execution mode, refresh
interval — is read from `# @asyar.*` comment directives at the top of the
file. The syntax is intentionally close to Raycast's Script Commands so
existing scripts port over with minor edits.

## Where scripts come from

The user adds one or more directories in **Settings → Scripts**. The Rust
scanner ([`src-tauri/src/scripts/scanner.rs`](../../asyar-launcher/src-tauri/src/scripts/scanner.rs))
walks each directory non-recursively, reads the first comment block of
every executable file, and registers matching files as dynamic commands
under the built-in `scripts` extension. A filesystem watcher rescans on
add / delete / modify (no debounce — per the user's preference).

A file must satisfy three conditions to register:

1. **Executable bit set** (`chmod +x`).
2. **Parseable header** — at minimum, `# @asyar.title` must be present.
3. **No header errors** — invalid argument JSON, out-of-range argument
   index, duplicate index, or unrecognised mode/refreshTime values cause
   the file to be skipped with a `script_header_invalid` diagnostic.

The launcher exposes the discovered scripts under stable dynamic ids
(`cmd_scripts_dyn_<hash>`). The hash is derived from the absolute path,
so moving a script breaks its alias history but renaming the file does
not.

## Header anatomy

The header is a contiguous block of `#`-prefixed comment lines at the top
of the file. A `#!` shebang on line 1 is allowed and skipped. The block
ends at the first non-comment, non-shebang line — everything below the
header is the script body.

```bash
#!/bin/bash
# @asyar.title Search Google
# @asyar.icon 🔍
# @asyar.argument:1 { "name": "query", "type": "text", "placeholder": "Search..." }

open "https://www.google.com/search?q=$1"
```

## Directives

### `@asyar.title <text>` — required

The name shown in the launcher list. Single line, plain text. Without
this directive the script is not registered.

```bash
# @asyar.title Daily Standup Notes
```

### `@asyar.icon <emoji | icon-name | image-path>` — optional

The icon shown next to the title. Three forms are accepted:

| Form | Example | Notes |
|---|---|---|
| Emoji | `🔔` | Any Unicode emoji. Renders inline. |
| Icon name | `icon:terminal` | Built-in icon set; see [Design system](./design-system/). |
| Image path | `images/icon.png` | Relative to the script file's directory. PNG/JPG/SVG. |

When absent the launcher falls back to `icon:terminal`.

### `@asyar.argument:<N> <json>` — optional, max 3

Declares a chip-row input that the launcher collects before running the
script. The JSON value is the same `CommandArgument` shape used by
[Command Arguments](./command-arguments.md):

```bash
# @asyar.argument:1 { "name": "query", "type": "text",     "placeholder": "Search…", "required": true }
# @asyar.argument:2 { "name": "engine", "type": "dropdown", "default": "google", "data": [ { "value": "google", "title": "Google" }, { "value": "ddg", "title": "DuckDuckGo" } ] }
# @asyar.argument:3 { "name": "limit", "type": "number",   "default": 10 }
```

Rules:

- Indices are `1`, `2`, `3` — anything else is a header error.
- Indices must be unique; duplicates fail to register.
- Up to 3 arguments per script (chip-row real estate is finite).
- Values are passed to the script as positional argv in declared order:
  `$1`, `$2`, `$3`.
- Argument types are `text`, `password`, `dropdown`, `number`. Numbers
  are passed as their decimal representation (`"7"` not `7` — the shell
  has no numeric type).
- Last-value persistence: the launcher remembers the last value per
  `(scriptId, argName)` and pre-fills the chip on the next invocation.
  See [Command Arguments → Persistence](./command-arguments.md#persistence--last-value-pre-fill).

### `@asyar.mode <silent | compact | fullOutput | inline>` — optional

Declares how the script's output is surfaced. Defaults to `compact` when
absent.

| Mode | Behavior | Status |
|---|---|---|
| `silent` | Run, discard output, surface a notification on completion or failure. | Accepted; behaves like `compact` today. |
| `compact` | Default. One-shot run; full output available in RunView; succeeded/failed rows persist in the Scripts section per the [run-tracking lifecycle](../explanation/run-tracking.md). | ✅ |
| `fullOutput` | One-shot run; auto-open RunView with streaming output. | Accepted; behaves like `compact` today. |
| `inline` | Re-execute on a timer; first line of stdout becomes the row subtitle. See [Inline-mode scripts](#inline-mode-scripts). | ✅ |

The `silent` and `fullOutput` values are reserved for forthcoming
behaviour and accepted by the parser today so scripts written for them
won't break when those modes ship. They currently behave identically to
`compact`.

### `@asyar.refreshTime <N(s|m|h|d)>` — required for `mode: inline`

Sets the tick interval for inline-mode scripts. The value is `N` followed
by a unit suffix:

| Suffix | Meaning | Example |
|---|---|---|
| `s` | seconds | `10s` |
| `m` | minutes | `5m` |
| `h` | hours   | `1h` |
| `d` | days    | `1d` |

The **minimum** is **10 seconds**. Values below this are clamped on
ingest and a one-time `inline_script_clamped` diagnostic toast is shown
to the user. Asyar matches Raycast's parser shape and floor.

For non-inline modes the directive is parsed but ignored.

## Inline-mode scripts

When `@asyar.mode inline` and a valid `@asyar.refreshTime` are both
present, the script becomes a **live row** — its first line of stdout
ticks in place as the row's subtitle. This is the dashboard pattern:
clock, weather, latest commit hash, battery %, build status.

### Tick lifecycle

A per-script tokio task is spawned in
[`src-tauri/src/scripts/inline_scheduler.rs`](../../asyar-launcher/src-tauri/src/scripts/inline_scheduler.rs).
On register (launcher start, file added, mode flipped to `inline`) it
fires one immediate tick so the row's subtitle is populated, then runs
the script every `refreshTime` seconds. Each tick:

1. Spawns the file directly via `tokio::process::Command::new(path)` —
   **bypasses** `shellService.spawn`.
2. Reads stdout line-by-line, stops at the **first non-empty trimmed
   line**, drops the rest.
3. Emits a `scripts:inline:tick` Tauri event with the captured line.
4. The TS launcher writes the line into
   `commandService.liveSubtitles['cmd_scripts_dyn_<id>']`; the row's
   subtitle updates reactively.
5. A 30-second per-tick timeout aborts the future if the script hangs.

### Run-promotion suppression (load-bearing invariant)

Inline ticks **must not promote a Run**. A 30-second clock script would
otherwise flood `runService.unacknowledgedScriptResults` with a kept-Done
row every tick, fire a "Script finished" notification every 30 seconds,
and double-count in the Scripts HUD chip. The suppression is achieved
structurally, not by gating: the inline scheduler does not call
`shellService.spawn`, so the auto-promotion path in that service is
unreachable for ticks.

**Manual Enter on an inline script's row still spawns a tracked Run** —
the dispatch goes through `dispatchScriptCommand → shellService.spawn`
like any other script, the user gets the full RunView output, and the
row briefly shows the standard Done · {tail} subtitle until they
dismiss it. After dismissal the inline tick resumes overwriting the
subtitle on its next interval.

### Cap: 10 concurrent inline scripts

Asyar matches Raycast's 10-script cap. When more than 10 inline scripts
are registered, the alphabetically-last entries by absolute path are
**not auto-ticked** — they fall back to manual-Enter invocation. A
single grouped `inline_script_capped` diagnostic lists the dropped
scripts so the user knows which ones aren't refreshing.

The cap is enforced by `partition_specs` in
[`inline_scheduler.rs`](../../asyar-launcher/src-tauri/src/scripts/inline_scheduler.rs)
and is deterministic across rescans regardless of file-system
enumeration order.

### Subtitle on tick error

If a tick fails (non-zero exit, spawn error, timeout), the row's
subtitle becomes `error: {message}`. The next successful tick replaces
it.

## Examples

### Inline clock

```bash
#!/bin/bash
# @asyar.title Asyar Clock Inline
# @asyar.icon ⏰
# @asyar.mode inline
# @asyar.refreshTime 10s

date '+%H:%M:%S'
```

### Inline battery (macOS)

```bash
#!/bin/bash
# @asyar.title Asyar Battery Inline
# @asyar.icon 🔋
# @asyar.mode inline
# @asyar.refreshTime 60s

pmset -g batt | grep -Eo '[0-9]+%'
```

### Search command with arguments

```bash
#!/bin/bash
# @asyar.title Search Google
# @asyar.icon 🔍
# @asyar.argument:1 { "name": "query", "type": "text", "placeholder": "Query", "required": true }

open "https://www.google.com/search?q=$(printf %s "$1" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')"
```

### Multi-arg search with dropdown engine pick

```bash
#!/bin/bash
# @asyar.title Multi-Search
# @asyar.icon 🌐
# @asyar.argument:1 { "name": "query",  "type": "text",     "placeholder": "Query", "required": true }
# @asyar.argument:2 { "name": "engine", "type": "dropdown", "default": "google", "data": [ { "value": "google", "title": "Google" }, { "value": "ddg", "title": "DuckDuckGo" }, { "value": "kagi", "title": "Kagi" } ] }

case "$2" in
  google) URL="https://www.google.com/search?q=$1" ;;
  ddg)    URL="https://duckduckgo.com/?q=$1" ;;
  kagi)   URL="https://kagi.com/search?q=$1" ;;
esac
open "$URL"
```

## Diagnostics surfaced to the user

| Kind | When | Severity |
|---|---|---|
| `script_header_invalid` | Header JSON malformed, duplicate argument index, out-of-range index, unknown mode, malformed refreshTime. | `warning` — file skipped, not registered. |
| `inline_script_clamped` | A script declared `@asyar.refreshTime` below 10s. Fired once per script. | `warning` — value raised to 10s, ticking proceeds. |
| `inline_script_capped` | More than 10 inline scripts present after a rescan. Fired once per newly-overflowed script. | `warning` — capped scripts still run on manual Enter, just don't auto-tick. |

All three flow through the unified `diagnosticsService` channel — they
appear as toast banners alongside other launcher diagnostics.

## Relationship to dynamic commands and Run Tracker

- Scripts are registered through the dynamic-command system. See
  [Dynamic Commands](./dynamic-commands.md) for the underlying registry
  semantics; everything that applies to dynamic commands (stable ids,
  last-value persistence, search ranking) applies to scripts too.
- Manual script invocations are tracked by the [Run Tracker](../explanation/run-tracking.md)
  with `kind: shell-script` and surface as `Done · {tailOutput}` or
  `Failed · {tailOutput}` rows in the Scripts section.
- Inline ticks deliberately do not enter the Run Tracker — see the
  [run-promotion suppression invariant](#run-promotion-suppression-load-bearing-invariant).
