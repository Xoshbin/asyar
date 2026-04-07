export type SelectionErrorCode =
  | "ACCESSIBILITY_PERMISSION_REQUIRED"
  | "ACCESSIBILITY_UNAVAILABLE"
  | "CLIPBOARD_RESTORE_FAILED"
  | "OPERATION_FAILED";

export interface SelectionError extends Error {
  code: SelectionErrorCode;
}

/**
 * Selection service — allows reading selected text or file items from the frontmost application.
 */
export interface ISelectionService {
  /** 
   * Returns selected text or null if nothing is selected. 
   * Throws SelectionError on hard failure only. 
   * 
   * Requires the `selection:read` permission.
   */
  getSelectedText(): Promise<string | null>;

  /** 
   * Returns absolute paths of selected file-manager items, or [] if none.
   * 
   * Requires the `selection:read` permission.
   */
  getSelectedFinderItems(): Promise<string[]>;
}
