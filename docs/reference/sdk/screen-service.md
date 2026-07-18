### 8.35 `ScreenService` — Sample a screen pixel with the OS eyedropper

**Runs in:** both worker and view.

**Permission required:** `screen:pick-color`.

`ScreenService` shows the operating system's native eyedropper and resolves with the sRGB color of the single pixel the user picks. It is the first-class, cross-platform replacement for shelling out to a screenshot tool and decoding a pixel yourself. No screen contents are read except the one sampled pixel.

The picker chrome is platform-native:

- **macOS** — `NSColorSampler` (the same magnifier loupe the system color picker uses). No Screen Recording permission is required.
- **Linux** — the XDG desktop portal `Screenshot.PickColor` (native loupe) where available, with an X11 crosshair-grab fallback on bare sessions.
- **Windows** — a click-to-pick crosshair backed by `GetPixel`. There is no built-in visual pick-mode indicator, so show a HUD first (see below).

```typescript
/** One sampled screen pixel in sRGB, as returned by the OS eyedropper. */
export interface PickedColor {
  r: number; // red channel, 0–255
  g: number; // green channel, 0–255
  b: number; // blue channel, 0–255
  hex: string; // lowercase `#rrggbb` of the same value
}

export interface IScreenService {
  /** Resolves with the picked color, or `null` if the user cancelled (Esc). */
  pickColor(): Promise<PickedColor | null>;
}
```

**Hide the launcher first.** The launcher window sits under the cursor when you open the picker, so call `ctx.hideLauncher()` before `pickColor()` — otherwise the user's first pick lands on your own UI. On Windows, also surface a HUD (`FeedbackService.showHUD(...)`) so the user knows the eyedropper is armed, since the OS gives no visual cue.

```typescript
import type { IScreenService } from 'asyar-sdk/contracts';

const screen = context.getService<IScreenService>('screen');

context.hideLauncher();
const color = await screen.pickColor();
if (color) {
  // e.g. "#ff8800" — copy it, add it to a palette, etc.
  await clipboard.writeToClipboard(color.hex);
}
// `null` means the user pressed Esc — do nothing.
```

`pickColor()` is a user-interaction primitive: it never resolves until the user picks or cancels, so treat it like an `await`ed dialog, not a background query.
