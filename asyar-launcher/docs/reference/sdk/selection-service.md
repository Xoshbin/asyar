### 8.14 `SelectionService` — Read selected text & file-manager items

**Permission required:** `selection:read` (gates both methods).

Reads the user's current selection from whatever app is frontmost when your extension runs. Two methods, both opt-in via a single permission, both return clean serializable data:

```typescript
type SelectionErrorCode =
  | 'ACCESSIBILITY_PERMISSION_REQUIRED'
  | 'ACCESSIBILITY_UNAVAILABLE'
  | 'CLIPBOARD_RESTORE_FAILED'
  | 'OPERATION_FAILED';

interface SelectionError extends Error {
  code: SelectionErrorCode;
}

interface ISelectionService {
  /**
   * Returns the text currently selected in the frontmost application.
   * - Resolves to the selected string when something is selected.
   * - Resolves to `null` when nothing is selected, the focused widget is
   *   not a text widget, or the platform's accessibility API and the
   *   clipboard fallback both produced nothing within the timeout window.
   * - Throws SelectionError only on hard failures (missing accessibility
   *   permission, clipboard restore failure, etc.).
   */
  getSelectedText(): Promise<string | null>;

  /**
   * Returns the absolute file system paths of items currently selected in
   * the frontmost file manager.
   * - Resolves to an array of absolute paths when one or more items are
   *   selected in a recognised file manager.
   * - Resolves to `[]` when nothing is selected or the frontmost app is
   *   not a file manager Asyar can query.
   * - Never returns `null` — callers can iterate the result without a
   *   nullish guard.
   */
  getSelectedFinderItems(): Promise<string[]>;
}
```

**Typical "act on selection" pattern:**

```typescript
import type { ISelectionService, SelectionError } from 'asyar-sdk';

const selection = context.getService<ISelectionService>('selection');
const feedback  = context.getService<IFeedbackService>('feedback');

async function translateSelection() {
  let text: string | null;
  try {
    text = await selection.getSelectedText();
  } catch (err) {
    const sel = err as SelectionError;
    if (sel.code === 'ACCESSIBILITY_PERMISSION_REQUIRED') {
      await feedback.showToast({
        title: 'Accessibility permission required',
        message: 'Grant Asyar access in System Settings to read selected text.',
        style: 'failure',
      });
      return;
    }
    throw err;
  }

  if (!text) {
    await feedback.showHUD('No text selected');
    return;
  }

  const translated = await translate(text);
  await feedback.showToast({ title: translated, style: 'success' });
}
```

**Acting on selected files:**

```typescript
async function compressSelectedFiles() {
  const paths = await selection.getSelectedFinderItems();
  if (paths.length === 0) {
    await feedback.showHUD('No files selected');
    return;
  }
  await api.compress(paths);
  await feedback.showToast({
    title: `Compressed ${paths.length} file${paths.length === 1 ? '' : 's'}`,
    style: 'success',
  });
}
```

#### How it works under the hood

`getSelectedText()` runs a two-step algorithm:

1. **Native accessibility fast path.** Asyar queries the platform's accessibility API directly (macOS AX, Windows UI Automation, Linux AT-SPI2). If the focused element exposes its selection, the value is returned immediately without touching the clipboard.
2. **Clipboard-trick fallback.** If the fast path returns nothing (the app is sandboxed, an Electron process, or a custom widget that doesn't expose selection through accessibility), Asyar:
   - Snapshots the user's current clipboard contents.
   - Posts a Copy chord (Cmd+C / Ctrl+C) to the frontmost app.
   - Polls for the clipboard sequence number / change marker for up to 250 ms.
   - Reads the new clipboard contents.
   - **Restores the original clipboard contents** before returning.

   The restore is bullet-proofed by an RAII guard — even if the operation errors out partway through, your clipboard comes back as it was. The restore is the one operation Asyar surfaces as a hard failure (`code === 'CLIPBOARD_RESTORE_FAILED'`) — silent corruption of the clipboard is unacceptable.

`getSelectedFinderItems()` uses native, file-manager-specific paths:
- **macOS:** AppleScript against Finder (`POSIX path of (selection as alias list)`).
- **Windows:** COM enumeration of `IShellWindows` to find the Explorer window matching the previously focused HWND, then `IShellFolderViewDual2.SelectedItems()`.
- **Linux X11:** Tier-A clipboard fallback — posts Ctrl+C, reads the file manager's `text/uri-list` clipboard target, parses `file://` URIs.

#### Concurrency

Only one selection operation can be in flight at a time across all extensions. If two extensions call `getSelectedText()` simultaneously, the second call waits for the first to finish before running its own clipboard trick. This prevents the kind of race where two extensions stomp on each other's clipboard snapshots.

#### Platform support matrix and limitations

| Capability | macOS | Windows | Linux X11 | Wayland |
|---|---|---|---|---|
| `getSelectedText()` — accessibility fast path | ✅ AX API | ✅ UIA `TextPattern` | ⚠️ AT-SPI2 (depends on `at-spi2-core` running) | ❌ Not supported |
| `getSelectedText()` — clipboard fallback | ✅ Multi-format snapshot, restores images & files intact | ⚠️ Text-only snapshot (see below) | ⚠️ Text-only snapshot (see below) | ❌ Not supported |
| `getSelectedFinderItems()` | ✅ Finder via AppleScript | ✅ File Explorer via COM | ⚠️ Tier-A clipboard URI list (Nautilus, Nemo, Thunar, Dolphin) | ❌ Not supported |

**Limitations to be aware of:**

- **Wayland is not supported.** All selection capture relies on global input simulation, which only works on X11 on Linux. This is the same limitation as Asyar's snippet expansion system. See the OS Support Matrix in the launcher README.
- **Windows / Linux clipboard snapshot is text-only.** When the clipboard-trick fallback fires on Windows or Linux, only the text representation of the clipboard is preserved. **If the user has a non-text item on the clipboard (an image, a file list, rich text from a word processor) and your extension triggers the clipboard fallback, that non-text content is lost.** macOS uses a multi-format snapshot via `NSPasteboardItem` enumeration and is not affected. This is documented in the source as a `TODO` for follow-up work; until then, prefer designing extensions that call `getSelectedText()` only when the user explicitly invokes them.
- **macOS Accessibility permission is required.** On the first call, if Asyar has not been granted Accessibility permission in System Settings → Privacy & Security → Accessibility, the call rejects with `code === 'ACCESSIBILITY_PERMISSION_REQUIRED'` and Asyar opens the relevant System Settings panel. Catch the error and prompt the user to grant access.
- **Linux AT-SPI2 must be available.** If the user's session does not have `at-spi2-core` running (or the GTK module bridge is disabled), the AT-SPI fast path silently returns nothing and Asyar falls back to the clipboard trick. AT-SPI is enabled by default on the major desktop environments.
- **Linux AT-SPI tree walk is O(n).** The current implementation walks the accessible tree from the root to find the focused element, which can be slow on complex applications. Acceptable for occasional explicit invocations; not suitable for high-frequency polling.
- **Linux file managers — Tier-A coverage.** `getSelectedFinderItems()` on Linux works with file managers that put `text/uri-list` on the clipboard via Ctrl+C: Nautilus (GNOME Files), Nemo (Cinnamon), Thunar (XFCE), Dolphin (KDE). File managers outside this set (older PCManFM, niche launchers) silently return `[]`. There is no Tier-B AT-SPI walk fallback in the current release.
- **Sandboxed and Electron apps.** The accessibility fast path frequently returns nothing for sandboxed App Store apps, Electron apps (VS Code, Slack, Discord), and rich web content. The clipboard fallback usually succeeds for these — but only if the app correctly handles a posted Copy chord.
- **Password fields.** All three platforms intentionally redact accessibility access to password fields. Asyar respects this; you cannot read selected text from a password field, and you should not attempt to.

#### Error handling

| `SelectionErrorCode` | When it fires | What to do |
|---|---|---|
| `ACCESSIBILITY_PERMISSION_REQUIRED` | macOS — Asyar lacks Accessibility permission. Asyar automatically opens the System Settings panel. | Show a toast or HUD telling the user to grant access; the call will work after they do. |
| `ACCESSIBILITY_UNAVAILABLE` | The platform's accessibility subsystem is not running (rare; primarily Linux without `at-spi2-core`). | Inform the user; degrade gracefully. |
| `CLIPBOARD_RESTORE_FAILED` | The clipboard snapshot was captured but the restore step failed. The user's clipboard may be in an unexpected state. | Surface the error visibly. This is rare but important. |
| `OPERATION_FAILED` | Generic catch-all for OS API errors. | Log; consider falling back to a different code path. |

A `null` return from `getSelectedText()` and an empty array from `getSelectedFinderItems()` are **not errors** — they are the expected "nothing was selected" outcome. Don't wrap them in try/catch logic.

#### Privacy & security

`selection:read` is a privacy-sensitive permission. An extension with this permission can see whatever the user has highlighted in another app at the moment the extension runs. The threat profile is comparable to `clipboard:read`, which is already part of the platform — both reveal user content from outside Asyar. Reviewers will inspect the use of `selection:read` during store review and reject extensions that ask for it without a clear, user-visible reason.

The permission is declared at install time in `manifest.json` and there is no per-call runtime prompt. This matches Asyar's other permission patterns (clipboard, network, filesystem). If your extension only occasionally needs the selection, gate the call behind an explicit user action — a button click, a search shortcut — rather than running it on every invocation.

---
