## 16. Debugging Workflows

### Step 1 — Check the Asyar developer log

Open Asyar → tray menu → **Developer Log**. All `LogService` calls from your extension appear here with timestamps, categories, and colors. This is the primary debugging interface.

### Step 2 — Open browser DevTools for the iframe

Asyar is built on Tauri/WebKit. You can open WebKit Inspector for the extension iframe:

1. Enable developer mode in Asyar settings.
2. Right-click inside your extension's view → **Inspect Element**.
3. The full WebKit DevTools open for your iframe's context.

From DevTools you can:
- Inspect the DOM, styles, and layout.
- Use the Console to run JavaScript in your extension's context.
- Set breakpoints in the Sources panel.
- Monitor the Network tab (note: `window.fetch()` is blocked, but SDK-routed calls show in the Console logs).

### Step 3 — Watch the raw IPC messages

All messages between your iframe and the host travel as `postMessage` events. In DevTools Console:

```javascript
// Monitor incoming messages (from host)
window.addEventListener('message', (e) => console.log('[IPC IN]', e.data));

// Monitor outgoing messages (to host) — patch the postMessage call
const _orig = window.parent.postMessage.bind(window.parent);
window.parent.postMessage = (msg, target) => {
  console.log('[IPC OUT]', msg);
  _orig(msg, target);
};
```

### Step 4 — Validate your manifest

```bash
asyar validate
```

Many extension loading failures are manifest validation errors (wrong `id` format, missing `resultType`, etc.).

### Step 5 — Check the dev extension registry

If your extension does not appear in the launcher after scaffolding, check that the dev registry has your path:

```
~/.config/Asyar/dev_extensions.json
```

It should contain an entry mapping your extension ID to the absolute path. If it is missing, run `asyar link` or use the Create Extension tool.

### Common issues and solutions

| Symptom | Cause | Fix |
|---|---|---|
| Extension not appearing in search | Manifest `id` doesn't match directory name | Rename directory to exactly match `id` |
| Extension not appearing in search | Not registered in dev registry | Run `asyar link` |
| Blank white iframe panel | `main.ts` throws before mounting | Open DevTools, check Console for errors |
| `asyar:extension:loaded` never fired | `window.parent.postMessage` call missing from `main.ts` | Add the loaded signal (see template) |
| Service call hangs for 10s then rejects | Missing permission | Declare permission in `manifest.json` |
| External URL fetch blocked | Using `window.fetch()` directly | Use `NetworkService` instead |
| ⌘K shows stale actions from old view | Actions not unregistered in `onDestroy` | Add `actionService.unregisterAction()` cleanup |
| Changes not reflected after save | `pnpm dev` not running | Start `pnpm dev` (Vite watch mode) |
| Double IPC calls | Two `ExtensionContext` instances created | Keep exactly one context in `main.ts` |

---
