### 8.24 `WindowManagementService` — Frontmost window bounds and fullscreen

**Runs in:** view only. Window management is invoked from a user-driven
view action.

**Permission required:** `window:manage`

The `WindowManagementService` lets extensions read and manipulate the position, size, and fullscreen state of the **frontmost OS application window** — the window the user had open before invoking Asyar.

```typescript
interface IWindowManagementService {
  /** Returns the current bounds of the frontmost OS application window. */
  getWindowBounds(): Promise<WindowBounds>;

  /**
   * Updates the position and/or size of the frontmost OS application window.
   * Only the fields you provide are changed; omit the rest.
   */
  setWindowBounds(update: Partial<WindowBounds>): Promise<void>;

  /**
   * Toggles the fullscreen state of the frontmost OS application window.
   * On Windows this maps to maximize / restore.
   */
  setFullscreen(enable: boolean): Promise<void>;
}

interface WindowBounds {
  /** Logical pixels from the left edge of the monitor. */
  x: number;
  /** Logical pixels from the top edge of the monitor. */
  y: number;
  /** Logical width in pixels. */
  width: number;
  /** Logical height in pixels. */
  height: number;
}
```

**Usage:**

```typescript
const winService = context.getService<IWindowManagementService>('window');

// Read current bounds
const bounds = await winService.getWindowBounds();
console.log(`Window at (${bounds.x}, ${bounds.y}), size ${bounds.width}×${bounds.height}`);

// Move window right by 50px without changing size
await winService.setWindowBounds({ x: bounds.x + 50, y: bounds.y });

// Resize to 1280×800 without moving
await winService.setWindowBounds({ width: 1280, height: 800 });

// Enter fullscreen
await winService.setFullscreen(true);
```

### Platform Notes

#### macOS
Uses the **Accessibility API** (`AXUIElement`) to read and write the focused window's `AXPosition`, `AXSize`, and `AXFullScreen` attributes. This requires **Accessibility permission** granted to Asyar in **System Settings → Privacy & Security → Accessibility**. If the permission is missing, all three methods throw with a descriptive error pointing to the settings panel.

Coordinates use a top-left origin and may be negative for windows on a monitor to the left of the primary display — this is correct behaviour.

#### Windows
Targets the window that was foreground when Asyar was last opened (captured via `GetForegroundWindow` at show time). `setWindowBounds` calls `MoveWindow`; `setFullscreen(true)` maximizes the window and `setFullscreen(false)` restores it. True borderless fullscreen for external windows is not supported.

#### Linux (X11)
Requires [`xdotool`](https://github.com/jordansissel/xdotool) to be installed (`apt install xdotool`, `pacman -S xdotool`, etc.). Asyar captures the active window ID via `xdotool getactivewindow` before showing itself.

**Wayland is not supported.** Calling any method under a Wayland session returns an error with a message directing the user to use an X11/XOrg session.

---
