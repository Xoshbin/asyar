/**
 * Visual style for a toast.
 *
 * - `animated` — loading state, no auto-dismiss; the caller is expected to
 *   call `hideToast` once the underlying operation finishes, or report the
 *   outcome via `diagnosticsService.report({ severity: 'success' | 'error', kind: 'manual', ... })`.
 */
export type ToastStyle = "animated";

export interface ShowToastOptions {
  /** Primary message. Required. */
  title: string;
  /** Optional second line (e.g. error details, secondary info). */
  message?: string;
  /** Visual style. Defaults to `animated` (loading look, no auto-dismiss). */
  style?: ToastStyle;
  /**
   * Auto-dismiss in ms. Currently unused (the only style is `'animated'`,
   * which never auto-dismisses). Reserved for future use.
   */
  durationMs?: number;
}

export interface ConfirmAlertOptions {
  /** Dialog heading. Required. */
  title: string;
  /** Body text. Required. */
  message: string;
  /** Confirm button label. Defaults to `"Confirm"`. */
  confirmText?: string;
  /** Cancel button label. Defaults to `"Cancel"`. */
  cancelText?: string;
  /**
   * Visual variant. `'danger'` shows ⚠️ + red confirm button.
   * Defaults to `'default'`.
   */
  variant?: "default" | "danger";
}

/**
 * Unified in-launcher feedback service.
 *
 * Exposes the three Raycast-style primitives — toast, HUD, confirm dialog —
 * to both Tier 1 built-in features and Tier 2 sandboxed extensions through
 * the same SDK proxy interface.
 *
 * The host service maintains the active toast/dialog and renders them
 * through `<ToastHost />` and `<DialogHost />` mounted at the launcher root.
 * The HUD is rendered in a dedicated transient Tauri window so it survives
 * the main launcher window being hidden.
 */
export interface IFeedbackService {
  /**
   * Show a non-blocking toast at the bottom of the launcher window.
   * Returns the toast id so the caller can update or hide it later.
   * Multiple successive calls REPLACE the current toast (only one toast
   * at a time).
   */
  showToast(options: ShowToastOptions): Promise<string>;

  /**
   * Update an existing toast in place (e.g. change the title while still
   * loading). No-op if the toast id no longer matches the active toast.
   */
  updateToast(
    toastId: string,
    options: Partial<ShowToastOptions>,
  ): Promise<void>;

  /**
   * Dismiss a toast immediately. No-op if not the active toast.
   */
  hideToast(toastId: string): Promise<void>;

  /**
   * Show a HUD message at the bottom of the active screen AND close the
   * launcher window. Fire-and-forget. Auto-dismisses after ~1500ms.
   */
  showHUD(title: string): Promise<void>;

  /**
   * Show a blocking confirmation dialog. Resolves with `true` (confirmed)
   * or `false` (cancelled / Escape / backdrop click).
   *
   * Only one dialog can be open at a time. If a dialog is already open
   * when this is called, the new call resolves with `false` and the
   * existing dialog is left unchanged. Callers do NOT need to wrap this
   * in try/catch.
   */
  confirmAlert(options: ConfirmAlertOptions): Promise<boolean>;
}
