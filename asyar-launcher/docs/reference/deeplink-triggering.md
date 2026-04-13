---
order: 8
---
# Deeplink Triggering

**No permission or manifest flag required.** Every command in an enabled extension is automatically reachable via deep links.

Any external source — browser, terminal, automation tool, another app — can invoke an extension command by opening an `asyar://extensions/{extensionId}/{commandId}` URL. The only requirement is that the extension is installed and enabled.

---

## Quick start

Trigger a command from a terminal:

```bash
open "asyar://extensions/com.example.currency/convert?from=USD&to=EUR&amount=100"
```

Generate a deeplink from inside your extension:

```typescript
const url = context.createDeeplink('convert', { from: 'USD', to: 'EUR', amount: '100' });
// → "asyar://extensions/com.example.currency/convert?from=USD&to=EUR&amount=100"
```

---

## URL format

```
asyar://extensions/{extensionId}/{commandId}?key=value&key2=value2
```

| Segment | Description |
|---|---|
| `extensionId` | The extension's `id` as declared in `manifest.json`. |
| `commandId` | The command's `id` as declared in `manifest.json`. |
| Query params | Passed to `executeCommand` as `args`. All values are strings. URL-encoding is handled automatically. |

### Character constraints

- `extensionId` — alphanumeric characters, dots, hyphens, and underscores only (e.g. `com.example.my-ext`).
- `commandId` — alphanumeric characters, hyphens, and underscores only.
- URLs that fail these rules are silently dropped in Rust before reaching the frontend.

---

## Receiving deeplink calls

When a deeplink fires, Asyar calls your extension's `executeCommand` method:

```typescript
class MyCurrencyExtension implements Extension {
  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'convert') {
      const isDeeplink = args?.deeplinkTrigger === true;
      const from   = args?.from   ?? 'USD';
      const to     = args?.to     ?? 'EUR';
      const amount = Number(args?.amount ?? 1);
      await this.convert(from, to, amount);
    }
  }
}
```

The `args` object includes `{ deeplinkTrigger: true }` alongside any query params, so you can distinguish a deeplink invocation from a manual user selection if needed.

### Args are always strings

All query parameter values arrive as strings. Parse them explicitly:

```typescript
const amount = Number(args?.amount);   // "100" → 100
const enabled = args?.enabled === 'true';  // "true" → true
```

---

## `context.createDeeplink()` — SDK utility

Extensions can generate deeplink URLs for their own commands using `createDeeplink()` on the `ExtensionContext`:

```typescript
createDeeplink(commandId: string, args?: Record<string, string>): string
```

This is a pure string utility — no IPC, no async, no permissions. Use it to embed deeplinks in:

- Notification bodies
- Clipboard output (e.g. "copied link to clipboard")
- Generated documents or Markdown
- Inter-app communication

```typescript
class TaskManager implements Extension {
  private context!: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
  }

  async createTask(title: string): Promise<void> {
    const taskId = await this.saveTask(title);
    const link = this.context.createDeeplink('open-task', { id: taskId });
    // link = "asyar://extensions/com.example.tasks/open-task?id=abc123"

    await this.context.proxies.NotificationService.notify({
      title: 'Task created',
      body: `Click to open: ${link}`,
    });
  }
}
```

---

## Window behavior

| Command `resultType` | Window behavior |
|---|---|
| `"no-view"` | Launcher stays hidden. Command executes silently in the background. |
| `"view"` | Launcher opens and navigates to the extension's view. |

For `"view"` type extensions (manifest `type: "view"`), the window always opens regardless of the command's `resultType`.

---

## Required preferences

Deeplink invocations bypass the required-preferences prompt — there is no user present to fill in a form. If your command has `required: true` preferences that are unset, the command will still execute and receive `undefined` for those preference values. Design your handler to handle missing preferences gracefully, or guide users to configure the extension first via Settings → Extensions.

---

## Use case examples

### Browser → Asyar ("Save this page")

A bookmarklet or browser extension passes the current page URL:

```javascript
window.open(`asyar://extensions/com.example.bookmarks/save?url=${encodeURIComponent(location.href)}&title=${encodeURIComponent(document.title)}`);
```

### Terminal shortcut

A shell alias triggers a command silently:

```bash
alias weather='open "asyar://extensions/com.example.weather/check?city=Berlin"'
```

### macOS Shortcuts / Automations

A Shortcuts workflow opens an `asyar://` URL as its action. Any extension command becomes a callable automation step — no app scripting or AppleScript required.

### Webhook → local action

A local webhook receiver (e.g. a small HTTP server) opens a deeplink in response to an external event:

```python
import subprocess
subprocess.run(["open", "asyar://extensions/com.example.deploy/notify?env=staging&status=success"])
```

### Sharing runnable commands

Share a deeplink in a team doc or Slack message. Anyone with the extension installed can click it to run the command:

```
Run our staging health check: asyar://extensions/com.example.devtools/health-check?env=staging
```

### Extension-generated links

An extension creates a deeplink and copies it to the clipboard for the user to share:

```typescript
const link = context.createDeeplink('view-report', { date: '2025-01-15' });
await navigator.clipboard.writeText(link);
```

---

## Validation and error handling

All validation happens before `executeCommand` is called. Invalid deep links are silently dropped with a log entry — they never reach your extension code.

| Condition | Behavior |
|---|---|
| Malformed URL or invalid characters | Dropped in Rust. Logged as warning. |
| Extension not installed | Dropped in TS. Logged as error. |
| Extension disabled | Dropped in TS. Logged as error. |
| Command not found in manifest | Dropped in TS. Logged as error. |
| Command handler throws | Error logged. Usage not recorded. |

---

## How it works under the hood

```
External source opens asyar://extensions/com.example.ext/cmd?arg=val

Rust (tauri-plugin-deep-link)         TS host                    Extension (iframe)
───────────────────────────────────────────────────────────────────────────────────
on_open_url fires
URL starts with "asyar://extensions/"
  → parse_extension_deeplink()
    validates extensionId + commandId
    collects query params
  → emit "asyar:deeplink:extension"
    { extensionId, commandId, args }
                                      DeeplinkService listens
                                      handleExtensionDeeplink():
                                        guard: extension exists?
                                        guard: extension enabled?
                                        guard: command in manifest?
                                        guard: command registered?
                                        if view: showWindow() + navigateToView()
                                        commandService.executeCommand(
                                          "cmd_{extensionId}_{commandId}",
                                          { ...args, deeplinkTrigger: true }
                                        )
                                        ──────────────────────────────────────►
                                        for Tier 2 (iframe) extensions:
                                          postMessage to iframe:
                                          { type: 'asyar:command:execute',
                                            payload: { commandId, args } }
                                                                           ExtensionBridge
                                                                           calls extension
                                                                           .executeCommand()
                                        recordItemUsage(objectId)
```

The URL is parsed entirely in Rust (`src-tauri/src/deeplink.rs`). The TS `DeeplinkService` (`src/services/deeplink/deeplinkService.svelte.ts`) owns all validation and dispatch logic. Neither layer requires a new Tauri command — Rust only emits an event, and TS listens.

---

## Interaction with the compatibility system

Deeplinks only execute for extensions whose compatibility status is `Compatible`. If an extension is incompatible (wrong SDK version, wrong app version, wrong platform), its commands cannot be triggered via deeplink.

---
