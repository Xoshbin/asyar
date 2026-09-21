// asyar-launcher/src/lib/ipc/ocrCommands.ts
// Tauri command wrappers for Screen OCR, re-exported through ./commands.
import { invokeSafe } from './invokeSafe';

/**
 * Initiates interactive screen capture and on-device OCR.
 *
 * Hides the launcher window, displays the native selection overlay, extracts
 * text via Apple Vision (on macOS), applies secret redaction, copies the text
 * to the system clipboard, and triggers a HUD notification.
 *
 * Returns the recognized/redacted text on success, or null if the user cancelled
 * or no text was found.
 */
export async function ocrCaptureScreenText(): Promise<string | null> {
  return invokeSafe<string | null>('ocr_capture_screen_text');
}
