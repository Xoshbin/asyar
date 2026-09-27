/**
 * One sampled screen pixel in sRGB, as returned by the OS eyedropper.
 */
export interface PickedColor {
  /** Red channel, 0–255. */
  r: number;
  /** Green channel, 0–255. */
  g: number;
  /** Blue channel, 0–255. */
  b: number;
  /** Lowercase `#rrggbb` hex of the same value. */
  hex: string;
}

/**
 * Screen sampling service.
 *
 * `pickColor` shows the OS eyedropper (native magnifier loupe on macOS and
 * on Linux desktops with an XDG portal; click-to-pick crosshair on Windows
 * and bare X11) and resolves once the user picks a pixel or cancels.
 *
 * Call `ctx.hideLauncher()` first so the launcher window doesn't sit under
 * the cursor. Requires the `screen:pick-color` manifest permission.
 */
export interface IScreenService {
  /** Resolves with the picked color, or `null` if the user cancelled (Esc). */
  pickColor(): Promise<PickedColor | null>;

  /**
   * Prompts the user with an interactive screen selection crosshair, captures the
   * bounded region, and performs on-device OCR. Sensitive credentials matching
   * known secret patterns are automatically redacted.
   * Resolves with the recognized text, or `null` if cancelled (Esc).
   * Requires the `screen:capture` manifest permission.
   */
  captureText(): Promise<string | null>;
}
