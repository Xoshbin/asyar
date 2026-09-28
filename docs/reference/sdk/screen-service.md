### 8.35 `ScreenService` — Eyedropper & Screen OCR

**Runs in:** both worker and view.

**Permissions required:**

- `screen:pick-color` for `pickColor()`
- `screen:capture` for `captureText()`

`ScreenService` provides operating system screen interaction primitives: sampling individual pixel colors with the native eyedropper and extracting text from screen regions with on-device OCR.

The picker chrome is platform-native:

- **macOS** — `NSColorSampler` (the same magnifier loupe the system color picker uses). No Screen Recording permission is required.
- **Linux** — the XDG desktop portal `Screenshot.PickColor` (native loupe) where available, with an X11 crosshair-grab fallback on bare sessions.
- **Windows** — a click-to-pick crosshair backed by `GetPixel`. There is no built-in visual pick-mode indicator, so show a HUD first (see below).

OCR text recognition runs entirely on-device:

- **macOS** — Apple Vision Framework.
- **Linux & Windows** — Local Tesseract OCR engine.

Extracted text automatically passes through Asyar's secret redaction filter before being returned.

```typescript
/** One sampled screen pixel in sRGB, as returned by the OS eyedropper. */
export interface PickedColor {
  r: number; // red channel, 0–255
  g: number; // green channel, 0–255
  b: number; // blue channel, 0–255
  hex: string; // lowercase `#rrggbb` of the same value
}

export interface IScreenService {
  /** Resolves with the picked color, or `null` if the user cancelled (Esc). Requires `screen:pick-color`. */
  pickColor(): Promise<PickedColor | null>;

  /**
   * Prompts the user with an interactive screen selection crosshair, captures the
   * bounded region, and performs on-device OCR. Sensitive credentials matching
   * known secret patterns are automatically redacted.
   * Resolves with the recognized text, or `null` if cancelled (Esc).
   * Requires `screen:capture`.
   */
  captureText(): Promise<string | null>;
}
```

#### Sampling colors (`pickColor`)

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

#### Extracting text from screen (`captureText`)

`captureText()` initiates interactive region selection and on-device text recognition. The launcher window dismisses during selection and returns the recognized, redacted text.

```typescript
import type { IScreenService } from 'asyar-sdk/contracts';

const screen = context.getService<IScreenService>('screen');

const text = await screen.captureText();
if (text) {
  console.log(`Recognized ${text.length} characters from screen selection`);
}
```
