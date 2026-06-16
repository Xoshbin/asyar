import { sendPendingUsage } from '../../lib/ipc/commands';

export class UsageSharePromptState {
  /** The day pending an Ask-mode usage share (null when none). */
  public pendingDay = $state<string | null>(null);

  /** Show the banner for a given day (received from the Rust event). */
  show(day: string): void {
    this.pendingDay = day;
  }

  /** Dismiss the banner without sending. */
  dismiss(): void {
    this.pendingDay = null;
  }

  /** Send the pending day's anonymous usage, then clear the banner. */
  async confirm(): Promise<void> {
    const day = this.pendingDay;
    if (!day) return;
    await sendPendingUsage(day);
    this.pendingDay = null;
  }
}

export const usageSharePromptState = new UsageSharePromptState();
