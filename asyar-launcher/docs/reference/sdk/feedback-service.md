### 8.13 `FeedbackService` — Toast / HUD / Confirm Dialog

**Permission required:** None.

Three primitives for user-facing feedback, modeled after Raycast. Use the right primitive for the situation:

| Primitive | What it is | When to use |
|---|---|---|
| `showToast(options)` | Small non-blocking message at the bottom of the **launcher window**. Three styles: `'animated'` (loading, no auto-dismiss), `'success'`, `'failure'`. Auto-dismisses after `durationMs` for non-animated styles. The launcher stays open. | "Saved", "Copied", "Failed to fetch". Progress that the user should watch: start as `'animated'`, then `updateToast(...)` to `'success'` or `'failure'` when the operation finishes. |
| `showHUD(title)` | Compact pill at the bottom of the **screen** (a separate transparent always-on-top window). **Simultaneously closes the launcher window.** No actions, no styles, just a string. Auto-dismisses after ~1.5s. | Fire-and-forget actions: "Brightness up", "Window snapped left", "Sent to Slack". The user wants the launcher gone but needs a confirmation it worked. |
| `confirmAlert(options)` | Blocking modal with primary/cancel buttons and an optional `'danger'` variant. Resolves with `true` or `false`. | Before destructive actions: "Delete this snippet?", "Overwrite file?". |

```typescript
type ToastStyle = 'animated' | 'success' | 'failure';

interface ShowToastOptions {
  title: string;
  message?: string;          // optional second line
  style?: ToastStyle;        // default 'animated'
  durationMs?: number;       // default 2500; ignored when style === 'animated'
}

interface ConfirmAlertOptions {
  title: string;
  message: string;
  confirmText?: string;      // default 'Confirm'
  cancelText?: string;       // default 'Cancel'
  variant?: 'default' | 'danger';
}

interface IFeedbackService {
  showToast(options: ShowToastOptions): Promise<string>;
  updateToast(toastId: string, options: Partial<ShowToastOptions>): Promise<void>;
  hideToast(toastId: string): Promise<void>;
  showHUD(title: string): Promise<void>;
  confirmAlert(options: ConfirmAlertOptions): Promise<boolean>;
}
```

**Toast — the canonical loading → success/failure pattern:**

```typescript
const feedback = context.getService<IFeedbackService>('FeedbackService');

async function syncBookmarks() {
  const toast = await feedback.showToast({
    title: 'Syncing bookmarks',
    style: 'animated',
  });
  try {
    const count = await api.sync();
    await feedback.updateToast(toast, {
      title: `Synced ${count} bookmarks`,
      style: 'success',
    });
  } catch (err) {
    await feedback.updateToast(toast, {
      title: 'Sync failed',
      message: err instanceof Error ? err.message : String(err),
      style: 'failure',
      durationMs: 4000,
    });
  }
}
```

**Confirm dialog — Promise-returning, no callbacks:**

```typescript
async function deleteBookmark(id: string, name: string) {
  const confirmed = await feedback.confirmAlert({
    title: 'Delete bookmark',
    message: `Delete "${name}"? This cannot be undone.`,
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;
  await api.delete(id);
  await feedback.showToast({ title: 'Bookmark deleted', style: 'success' });
}
```

**HUD — fire-and-forget, closes the launcher:**

```typescript
async function increaseBrightness() {
  await api.brightnessUp();
  await feedback.showHUD('Brightness ↑');
  // The launcher window is now closed; the HUD pill is visible at the
  // bottom of the active monitor for ~1.5s and then hides itself.
}
```

**Picking the right primitive — flowchart:**

```
Need to ask the user to confirm something destructive?
└─ Yes  → confirmAlert
└─ No
   ├─ Should the launcher CLOSE while the message is visible?
   │  └─ Yes  → showHUD
   │  └─ No
   │     ├─ Loading state that may take a while?
   │     │  └─ Yes  → showToast({ style: 'animated' }) then updateToast(...) on completion
   │     ├─ Success or failure of an action?
   │     │  └─ showToast({ style: 'success' | 'failure' })
   │     └─ Persistent metadata about the active view (e.g. provider/model label)?
   │        └─ NOT a feedback primitive — use ExtensionManager.setActiveViewSubtitle (§8.9)
```

**Constraints to be aware of:**

- Only one toast and one dialog can be active at a time. Calling `showToast` while another toast is visible **replaces** it (and cancels its auto-dismiss timer). Calling `confirmAlert` while another dialog is open resolves the new call with `false` and leaves the existing dialog unchanged — callers don't need a try/catch for the race.
- `confirmAlert` resolves with `false` for any non-confirm exit (cancel button, Escape, backdrop click, or a concurrent call that couldn't show its dialog). It never rejects.
- `showHUD` returns immediately after dispatching the show command. It does not wait for the HUD to auto-hide.
- The HUD is rendered in its own Tauri webview window (label `"hud"`, declared in `tauri.conf.json`). Both Tier 1 built-in features and Tier 2 sandboxed extensions go through the same SDK proxy → IPC router → Rust `show_hud` command path. There is no special privileged path.

> **Don't reach for `NotificationService` when you mean `showToast`.** OS notifications (`NotificationService`) leave the launcher entirely and hit the system notification center. They're heavyweight, intrusive, require the `notifications:send` permission, and are appropriate for "your download finished" *after the user has moved on*. For "I just did X inside the launcher and want to confirm it worked", `showToast` and `showHUD` are the right answer.

---
