import type {
  IFeedbackService,
  ShowToastOptions,
  ConfirmAlertOptions,
} from "asyar-sdk/contracts";
import * as commands from "../../lib/ipc/commands";

interface ActiveToast {
  id: string;
  title: string;
  message?: string;
  style: 'animated';
}

interface ActiveDialog {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger";
}

/** Default HUD visibility duration. */
const DEFAULT_HUD_DURATION_MS = 1500;

/**
 * Live handle on a spinning HUD. Returned by `showHUDSpinning`. The HUD stays
 * visible until you call `.dismiss()` or `.replace(...)`. `.replace(title)`
 * by default flips the HUD to a non-spinning state and schedules auto-hide,
 * which is the usual transition on success ("Done") or failure ("Error: …").
 */
export interface HudSpinnerHandle {
  /**
   * Replace the displayed title. By default the spinner stops and the HUD
   * is auto-hidden after `durationMs` (default 1500ms). Pass `spinning: true`
   * to keep the spinner visible (e.g. progress phases like "Reading…" →
   * "Thinking…").
   */
  replace(title: string, options?: { spinning?: boolean; durationMs?: number }): Promise<void>;
  /** Hide the HUD now. */
  dismiss(): Promise<void>;
}


class FeedbackService implements IFeedbackService {
  activeToast = $state<ActiveToast | null>(null);
  activeDialog = $state<ActiveDialog | null>(null);

  private toastIdCounter = 0;
  private dialogResolver: ((result: boolean) => void) | null = null;

  reset(): void {
    this.activeToast = null;
    this.activeDialog = null;
    this.dialogResolver = null;
    this.toastIdCounter = 0;
  }

  async showToast(options: ShowToastOptions): Promise<string> {
    const id = `toast-${++this.toastIdCounter}`;
    this.activeToast = {
      id,
      title: options.title,
      message: options.message,
      style: "animated",
    };
    return id;
  }

  async updateToast(
    toastId: string,
    options: Partial<ShowToastOptions>,
  ): Promise<void> {
    if (this.activeToast === null || this.activeToast.id !== toastId) return;
    this.activeToast = {
      ...this.activeToast,
      title: options.title ?? this.activeToast.title,
      message:
        "message" in options ? options.message : this.activeToast.message,
      style: "animated",
    };
  }

  async hideToast(toastId: string): Promise<void> {
    if (this.activeToast === null || this.activeToast.id !== toastId) return;
    this.activeToast = null;
  }

  async showHUD(title: string): Promise<void> {
    // Show the HUD window first (Rust positions it, displays the title, schedules
    // auto-hide), then hide the main launcher window. The HUD lives in its own
    // Tauri window, so it survives the main launcher hide.
    await commands.showHud({ title, durationMs: DEFAULT_HUD_DURATION_MS, spinning: false });
    try {
      await commands.hideWindow();
    } catch {
      // hideWindow can fail if called from a context where the main window is
      // already hidden (e.g. settings window). The HUD still shows correctly.
    }
  }

  /**
   * Show a HUD with a spinner that stays visible until dismissed or replaced.
   * Use for headless operations whose duration the user can't see — silent AI
   * commands, long-running shell-script triggers, anything where the launcher
   * window is hidden and the user needs a "this is running" signal.
   *
   * Returns a handle so the caller can drive lifecycle transitions:
   *   - `handle.replace('Done')` flips to a non-spinning HUD that auto-hides.
   *   - `handle.replace('Working...', { spinning: true })` updates the
   *     title without stopping the spinner (e.g. multi-phase progress).
   *   - `handle.dismiss()` hides the HUD immediately (useful when the
   *     visible result is the feedback — e.g. text replaced in place).
   */
  showHUDSpinning(title: string): HudSpinnerHandle {
    void commands.showHud({ title, durationMs: 0, spinning: true });
    return {
      replace: async (newTitle, options) => {
        const spinning = options?.spinning ?? false;
        const durationMs = options?.durationMs ?? DEFAULT_HUD_DURATION_MS;
        await commands.showHud({ title: newTitle, durationMs, spinning });
      },
      dismiss: async () => {
        await commands.hideHud();
      },
    };
  }

  async confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
    // If a dialog is already open, treat the second call as cancelled.
    // This matches Raycast's behavior and avoids forcing every caller to
    // wrap confirmAlert in try/catch just to handle a race condition.
    // The first dialog continues unaffected.
    if (this.activeDialog !== null) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      this.dialogResolver = resolve;
      this.activeDialog = {
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        variant: options.variant,
      };
    });
  }

  /** Called by `<DialogHost />` when the user clicks Confirm. */
  onDialogConfirmed(): void {
    const resolver = this.dialogResolver;
    this.dialogResolver = null;
    this.activeDialog = null;
    resolver?.(true);
  }

  /** Called by `<DialogHost />` when the user clicks Cancel, presses Escape, or clicks the backdrop. */
  onDialogCancelled(): void {
    const resolver = this.dialogResolver;
    this.dialogResolver = null;
    this.activeDialog = null;
    resolver?.(false);
  }
}

export const feedbackService = new FeedbackService();
