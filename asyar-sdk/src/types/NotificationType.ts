/**
 * A button on an OS notification that, when clicked, fires the specified
 * extension command with the provided args. The host looks the command up
 * in the extension's manifest and invokes it through the same dispatch
 * path a search-result click would use — no user code on the extension
 * side is needed to receive the event, the command handler just fires.
 */
export interface NotificationAction {
  /** Action-local identifier (unique within the notification). */
  id: string;
  /** Button label shown in the OS notification. */
  title: string;
  /**
   * The extension's own command to fire when this action is clicked.
   * Must match a command id declared in the extension's manifest.json —
   * the host rejects actions whose commandId is unknown.
   */
  commandId: string;
  /** Extra arguments passed to the command handler. Must be JSON-serialisable. */
  args?: Record<string, unknown>;
}

export interface NotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  /**
   * Optional action buttons. Platform action-count limits apply:
   * - **macOS**: 1 main button + optional close button (multi-action uses dropdown UI).
   * - **Linux**: depends on the notification daemon (GNOME/KDE typically 2–4).
   * - **Windows**: toast actions not yet wired through the Tauri plugin; notification sends without buttons.
   *
   * When a platform can't render actions, the notification is still sent —
   * the action buttons are silently dropped and a warning is logged.
   */
  actions?: NotificationAction[];
}
