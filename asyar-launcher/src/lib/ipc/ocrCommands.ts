// asyar-launcher/src/lib/ipc/ocrCommands.ts
// Tauri command wrappers for Screen OCR, re-exported through ./commands.
import { invokeRaw, invokeSafe } from './invokeSafe';

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

/** Platform-service transport for Tier 2 callers. Cancellation remains a
 * successful `null`; backend failures reject and are returned as IPC errors. */
export async function ocrCaptureScreenTextForExtension(): Promise<string | null> {
  return invokeRaw<string | null>('ocr_capture_screen_text');
}
