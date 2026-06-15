import * as commands from '../../lib/ipc/commands';
import type { CrashPayload } from '../../lib/ipc/commands';

export class CrashPromptState {
  /** Whether the Ask-mode banner is visible. */
  public visible = $state(false);

  /** The pending crash payload received from Rust (null when none). */
  public payload = $state<CrashPayload | null>(null);

  /** Email address pre-filled from auth (may be cleared by the user for anonymous sends). */
  public email = $state('');

  /** Whether a send/dismiss request is in flight. */
  public isSending = $state(false);

  /** Non-fatal error from a failed send attempt. */
  public sendError = $state<string | null>(null);

  /** Reset to the initial idle state. Useful in tests. */
  reset(): void {
    this.visible = false;
    this.payload = null;
    this.email = '';
    this.isSending = false;
    this.sendError = null;
  }

  /**
   * Query Rust for a pending crash payload. When one exists, pre-populates
   * the email (caller must supply it from authService) and shows the banner.
   */
  async load(prefillEmail?: string): Promise<void> {
    const pending = await commands.getPendingCrash();
    if (pending === null) {
      return;
    }
    this.payload = pending;
    this.email = prefillEmail ?? '';
    this.visible = true;
  }

  /** POST the report with the current email and hide the banner. */
  async send(): Promise<void> {
    this.isSending = true;
    this.sendError = null;
    try {
      await commands.sendPendingCrash(this.email);
      this.payload = null;
      this.visible = false;
    } catch (err) {
      this.sendError = err instanceof Error ? err.message : String(err);
    } finally {
      this.isSending = false;
    }
  }

  /** Dismiss the banner without sending; clear the pending crash from Rust. */
  async dismiss(): Promise<void> {
    if (this.isSending) return;
    await commands.dismissPendingCrash();
    this.payload = null;
    this.visible = false;
  }
}

export const crashPromptState = new CrashPromptState();
