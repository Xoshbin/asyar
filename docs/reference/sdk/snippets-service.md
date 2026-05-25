### 8.32 `SnippetsService` — Contribute `:shortcode:` expansions to the global keystroke matcher

**Runs in:** worker only.

**Permission required:** `snippets:contribute`.

`SnippetsService` lets an extension contribute a static dictionary of `:shortcode:` → expansion pairs to Asyar's system-wide snippets engine. Once registered, typing one of your shortcodes in **any** text input on **any** application — browser address bar, code editor, chat client — triggers an in-place replacement, just as if the user had created a snippet manually. No window opens, no UI flickers.

Keys follow the Slack-style bounded form `:[a-z0-9_+-]{1,32}:`. The opening `:` arms the matcher; the closing `:` commits the replacement. Examples: `:party:`, `:red_heart:`, `:+1:`, `:a-b:`. Uppercase, spaces, and out-of-charset characters are rejected at registration time.

```typescript
/** A dictionary mapping bounded shortcodes (`:xxx:`) to their expansion strings. */
export type ShortcodeMap = Record<string, string>;

export interface ISnippetsService {
  /**
   * Contribute a static dictionary to the launcher's global keystroke matcher.
   * Calling again replaces the calling extension's previous contribution
   * wholesale. Malformed keys cause the proxy to reject the whole call —
   * partial registration is never allowed.
   */
  registerShortcodes(map: ShortcodeMap): Promise<void>;

  /** Remove the calling extension's entire contribution. Idempotent. */
  unregisterShortcodes(): Promise<void>;
}
```

**Usage:**

```typescript
import type { ISnippetsService, ShortcodeMap } from 'asyar-sdk/contracts';

// In your worker entry point:
const snippets = context.getService<ISnippetsService>('snippets');

const map: ShortcodeMap = {
  ':party:': '🎉',
  ':fire:': '🔥',
  ':red_heart:': '❤️',
};

await snippets.registerShortcodes(map);

// Remove the contribution (e.g. when the extension is being deactivated):
await snippets.unregisterShortcodes();
```

**How it works under the hood:**

The SDK proxy (`SnippetsServiceProxy`) validates every key against the SHORTCODE_PATTERN regex (`^:[a-z0-9_+-]{1,32}:$`) before dispatch. On success it sends `snippets:registerShortcodes` to the launcher via the IPC broker. The launcher's `ExtensionIpcRouter` validates the `snippets:contribute` permission, then forwards the payload directly to the Rust `contribute_shortcodes` Tauri command (the snippets namespace bypasses the JS service registry and routes Tauri-direct).

On the Rust side, contributions are namespaced by extension id and stored in a separate `contributed_snippets` map on `AppState`. The keystroke matcher merges the user's manually-created snippets (the existing snippets engine catalog) on top of every extension's contribution at lookup time. **User snippets always shadow extension contributions on key collision** — if the user has `:party:` mapped to `PARTY!`, your `:party: → 🎉` contribution is silently masked for that user.

Uninstalling your extension drops its entire contribution atomically; you do not need to call `unregisterShortcodes` from a teardown hook.

**Replace-style semantics:**

`registerShortcodes` is replace-style, not additive. Each call replaces your extension's entire previous contribution. To grow the catalog, send the full updated map — there is no partial-update method.

```typescript
await snippets.registerShortcodes({ ':party:': '🎉' });
await snippets.registerShortcodes({ ':fire:': '🔥' }); // :party: is now gone
```

**Inline AI fallback (launcher-side, not part of this contract):**

When the user types `:xxx:` and no entry in the merged catalog (user snippets + every extension's contribution) matches, the launcher emits a `shortcode-miss` event. A built-in silent agent can be wired to that event to resolve the unknown shortcode via AI and paste-replace it inline. The cache + rate-limit + promote-to-snippet flow is a launcher feature gated by its own settings — extensions don't dispatch the AI agent themselves and don't need to be aware of it.

**Platform considerations:**

System-wide expansion works on macOS, Windows, and X11/XWayland Linux. **Pure Wayland sessions cannot deliver global keystrokes to unprivileged processes** (Wayland security model); on those sessions the listener becomes a one-time-warned no-op. The picker UI inside Asyar itself still works. Matches Espanso / AutoKey posture.

On macOS, system-wide expansion additionally requires **Accessibility permission** (System Settings → Privacy & Security → Accessibility). The user grants this once when first enabling snippets; your extension does not request it.

The launcher resolves typed characters through OS-native APIs (`NSEvent` on macOS, `ToUnicodeEx` on Windows, `libxkbcommon` on Linux) so shortcodes work correctly on every keyboard layout the OS knows about — AZERTY, QWERTZ, Dvorak, IME composition, dead keys, etc. — without per-extension configuration.

**Placement guidance:**

`SnippetsService` is exposed only in the worker proxy bag. Attempting to call it from the view bundle fails at module load with a role-assertion error. Register your contribution from `activate()` in the worker and let the launcher handle the lifetime — there is no DOM dependency.

Shortcode keys must match `^:[a-z0-9_+-]{1,32}:$`. The proxy rejects the whole call (atomic) if any key is malformed. Use short, lowercase, snake-case identifiers. Pick a unique prefix if your extension contributes many entries — there's no formal namespacing, just convention — to keep your contributions visually distinct from other extensions in the user's typing flow.

---
