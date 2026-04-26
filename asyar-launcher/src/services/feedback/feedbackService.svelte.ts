import type {
  IFeedbackService,
  ShowToastOptions,
  ConfirmAlertOptions,
  ToastStyle,
} from "asyar-sdk/contracts";
import * as commands from "../../lib/ipc/commands";

interface ActiveToast {
  id: string;
  title: string;
  message?: string;
  style: ToastStyle;
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

/** Default auto-dismiss for non-animated toasts. */
const DEFAULT_TOAST_DURATION_MS = 2500;

class FeedbackService implements IFeedbackService {
  activeToast = $state<ActiveToast | null>(null);
  activeDialog = $state<ActiveDialog | null>(null);

  private toastIdCounter = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private dialogResolver: ((result: boolean) => void) | null = null;

  reset(): void {
    this.clearToastTimer();
    this.activeToast = null;
    this.activeDialog = null;
    this.dialogResolver = null;
    this.toastIdCounter = 0;
  }

  async showToast(options: ShowToastOptions): Promise<string> {
    this.clearToastTimer();
    const id = `toast-${++this.toastIdCounter}`;
    const style = options.style ?? "animated";
    this.activeToast = {
      id,
      title: options.title,
      message: options.message,
      style,
    };
    this.scheduleToastDismiss(id, style, options.durationMs);
    return id;
  }

  private clearToastTimer(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  private scheduleToastDismiss(
    toastId: string,
    style: ToastStyle,
    durationMs: number | undefined,
  ): void {
    if (style === "animated") return;
    const ms = durationMs ?? DEFAULT_TOAST_DURATION_MS;
    this.toastTimer = setTimeout(() => {
      if (this.activeToast?.id === toastId) {
        this.activeToast = null;
      }
      this.toastTimer = null;
    }, ms);
  }

  async updateToast(
    toastId: string,
    options: Partial<ShowToastOptions>,
  ): Promise<void> {
    if (this.activeToast === null || this.activeToast.id !== toastId) return;
    const nextStyle: ToastStyle = options.style ?? this.activeToast.style;
    this.activeToast = {
      ...this.activeToast,
      title: options.title ?? this.activeToast.title,
      message:
        "message" in options ? options.message : this.activeToast.message,
      style: nextStyle,
    };
    this.clearToastTimer();
    this.scheduleToastDismiss(toastId, nextStyle, options.durationMs);
  }

  async hideToast(toastId: string): Promise<void> {
    if (this.activeToast === null || this.activeToast.id !== toastId) return;
    this.clearToastTimer();
    this.activeToast = null;
  }

  async showHUD(title: string): Promise<void> {
    // Show the HUD window first (Rust positions it, displays the title, schedules
    // auto-hide), then hide the main launcher window. The HUD lives in its own
    // Tauri window, so it survives the main launcher hide.
    await commands.showHud({ title, durationMs: DEFAULT_HUD_DURATION_MS });
    try {
      await commands.hideWindow();
    } catch {
      // hideWindow can fail if called from a context where the main window is
      // already hidden (e.g. settings window). The HUD still shows correctly.
    }
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
