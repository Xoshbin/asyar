### 8.6 `StatusBarService` — Tray menu live items

**Permission required:** None.

Register live-updating items in the Asyar system tray. Perfect for timers, background sync status, or any metric you want always visible.

```typescript
interface IStatusBarItem {
  id: string;
  icon?: string;   // Emoji or short symbol
  text: string;    // Display text (e.g. "18:32", "Syncing...")
}

interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(id: string, updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>): void;
  unregisterItem(id: string): void;
}
```

**Usage:**
```typescript
const statusBar = context.getService<IStatusBarService>('statusBar');

// Register a timer item
statusBar.registerItem({ id: 'pomodoro-timer', icon: '🍅', text: '25:00' });

// Update on each tick
statusBar.updateItem('pomodoro-timer', { text: '24:59' });

// Change phase
statusBar.updateItem('pomodoro-timer', { icon: '☕', text: '05:00' });

// Remove when idle
statusBar.unregisterItem('pomodoro-timer');
```

When a user clicks a tray item registered by your extension, Asyar opens the launcher and navigates to your extension's `defaultView`. Ensure `defaultView` is set in your manifest for click-to-navigate to work.

---
