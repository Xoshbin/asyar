### 8.9 `ExtensionManager` — Navigation and view metadata

**Permission required:** None.

The most commonly used service. Controls panel navigation and view-level metadata (action label and subtitle).

```typescript
interface IExtensionManager {
  navigateToView(viewPath: string): void;
  goBack(): void;
  setActiveViewActionLabel(label: string | null): void;
  setActiveViewSubtitle(subtitle: string | null): void;
  reloadExtensions(): Promise<void>;
  getAllExtensions(): Promise<any[]>;
  uninstallExtension(extensionId: string, extensionName: string): Promise<boolean>;
  searchAll(query: string): Promise<ExtensionResult[]>;
  isExtensionEnabled(extensionName: string): boolean;
  toggleExtensionState(extensionName: string, enabled: boolean): Promise<boolean>;
}
```

**Usage:**
```typescript
const manager = context.getService<IExtensionManager>('extensions');

// Navigate to a view — format: "<extensionId>/<ViewComponentName>"
manager.navigateToView('com.yourname.myext/DetailView');

// Navigate with context via URL params
manager.navigateToView('com.yourname.myext/DetailView?id=42&title=My+Item');

// Go back to the previous view (or to the search results if at root)
manager.goBack();

// Update the label shown in the bottom-right action bar
manager.setActiveViewActionLabel('Save Note');
manager.setActiveViewActionLabel(null); // clear

// Show a persistent secondary label next to the view title
// (e.g. "openai · gpt-4o", "5 unread", "Pro plan").
// This is view metadata, NOT transient feedback — it stays until you clear it.
manager.setActiveViewSubtitle('openai · gpt-4o');
manager.setActiveViewSubtitle(null); // clear when leaving the view
```

> **`setActiveViewSubtitle` is for persistent metadata, not progress.** If you want to show a transient "Saving...", "Saved", or "Failed to fetch" message, use `FeedbackService.showToast(...)` (§8.13). The subtitle has no auto-dismiss; the toast does.

**View navigation format:**

The `viewPath` string follows the pattern `<extensionId>/<ViewComponentName>`. The host translates this to:
```
asyar-extension://<extensionId>/index.html?view=<ViewComponentName>
```

Any additional `?key=value` parameters you append to `viewPath` are passed through to the iframe URL and are readable via `new URLSearchParams(window.location.search)`.

---
